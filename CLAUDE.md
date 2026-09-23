# Project: Worthwhile — a YouTube feed filter

## What it does
A Chrome/Edge extension (Manifest V3) that filters the YouTube web feed against
the user's own definition of worthwhile content. It hides slop, ragebait and
clickbait, surfaces content matching the user's interests (e.g. chess, maths,
science, literature, theatre), and measures whether sessions felt worth it.

## Status
- M1 (scoring test): built and approved. Tuning run on titles.csv: 93.7% at
  strictness 2 vs 88.9% at 3. Every error was a good video hidden; no bait got
  through. Strictness set to 2.
- Holdout (30 rows, run once 2026-09-23, strictness 2 frozen): 28/30 = 93.3%.
  Both misses were bait shown (Top Gear Classic compilation, CrunchLabs), with
  no good videos hidden. At strictness 3 the same scores gave 96.7%, a one-row
  difference, so the setting stays at 2. M1 PASSED.
- M2 (extension MVP): built 2026-09-23, waiting for the user's manual test on
  signed-in YouTube. Automated checks passed:
  - Worker against a mock API: auth, validation, D1 cache, strictness,
    re-scoring, 3 batches in parallel, model failure, expiry cron.
  - Content script on a mock home page: hiding, grid, hold, late-filled
    cards, re-score, errors, on/off, auto-load cap, fail-open.
  - Popup and options pages.
  - One live Worker → Claude call: all 4 verdicts matched the holdout labels.
  Not yet verified: the real YouTube home feed. In particular, whether
  YouTube's spinner loads the next page when our grid is shorter than the
  window (the test browser couldn't repaint without input).
- M3 onwards: not started. Wait for go-ahead after each milestone.

## Hard constraints
- Extension in plain JavaScript, NO bundler or build step. The /extension folder
  must load directly via "Load unpacked" in Chrome and Edge.
- No API keys in the extension. All model and YouTube API calls go through the backend.
- Backend: Cloudflare Worker (wrangler) with D1 for everything stored: score
  cache, search cache and session logs. No KV (decided 2026-09-23, see Decisions).
- Model: Anthropic API, model "claude-haiku-4-5-20251001", key stored as a Worker secret.
- ALL YouTube DOM selectors live in one file: extension/selectors.js.
- YouTube is a single-page app: handle navigation with the yt-navigate-finish
  event, not page loads.
- Privacy: log counts, durations and ratings only. Never log titles or video IDs
  of what a user watched.
- Each tester gets an invite token (entered on the options page); the Worker
  rejects requests without a valid token.
- On any scoring error, default to "show". Never blank the feed because of a failure.
  This includes D1 errors: a failed cache read is a cache miss, and a failed
  cache write or log write is ignored.

## Repo layout
/extension   manifest.json, content.js, selectors.js, background.js,
             popup.html, popup.js, options.html, options.js, styles.css,
             settings.js (defaults + loadSettings, shared by all parts),
             chips.js (interests editor used by popup and options),
             ui.css (popup/options styles; styles.css is injected into YouTube)
/worker      src/index.js (HTTP, auth, validation), src/score.js (cache + model),
             src/source.js (M3), wrangler.toml, schema.sql, dev.js (local run),
             package.json (wrangler + SDK)
/scripts     new-invite.js: makes an invite token and prints the D1 insert
/shared      prompt.js (scoring prompt, used by the worker AND the test script)
/scripts     score-test.js, titles.csv (tuning set), holdout.csv (never tuned on),
             profile.json, export-titles.console.js (DevTools snippet: copies
             home-feed cards as CSV rows; its SELECTORS block seeds selectors.js)
package.json root: "type": "module" and the @anthropic-ai/sdk dependency.
             The extension ignores it.
.env         ANTHROPIC_API_KEY for local scripts (gitignored; template in .env.example)
CLAUDE.md    this spec; keep it updated as decisions change

## Scoring (shared/prompt.js is the source of truth)
The model scores. The code decides show/hide.

- The model gets the user's rubric, interests and a batch of items
  [{id, title, channel, duration?, description?}], and returns
  {id, interest_match, substance, bait} per item. Each score is an integer from 0 to 10,
  with anchors given in the prompt. bait = clickbait, ragebait, AI slop, drama
  farming, plus anything the user's rubric explicitly says to hide (so the
  rubric's hide-list actually hides things).
- Structured outputs (output_config.format, json_schema) force valid JSON.
  parseScores() is still defensive: it clamps to 0-10 and drops unknown,
  duplicate or malformed entries. Ids missing from the result count as unscored,
  and unscored items are shown.
- verdictFor(scores, strictness) applies the rule in code. At strictness 3
  (the default) it hides if bait >= 6, or if interest_match < 4 and substance < 6.
  Strictness runs 1-5. Each step up makes every threshold one point stricter,
  each step down one point more lenient. Changing strictness never needs a
  re-score.
- Batch up to 20 items per call. temperature 0.
- Cache scores in D1 for 7 days, keyed by hash(rubric + interests) + video ID.
  No user ID is stored next to a video ID. Editing the rubric changes the hash,
  so old scores are skipped automatically.

Profile format (the options page saves this same shape; scripts/profile.json uses it):
  { "rubric": string, "interests": string[], "strictness": 1-5 }
The options page also stores the invite token, which is not part of the profile.

## Milestones
Stop after EACH milestone, tell me exactly how to test it by hand, and wait
for my go-ahead before starting the next.

M1 — Scoring test. scripts/score-test.js reads scripts/titles.csv
(columns: title, channel, my_verdict), scores the rows in batches using
shared/prompt.js, prints every disagreement with the model's scores, and prints
overall agreement %. Target: 85%+. Create titles.csv with 3 example rows.
Read the API key from a gitignored .env file.
  - Also prints agreement at every strictness level 1-5 from the same scores,
    and a token/cost estimate. `--dry-run` prints the prompt without calling the API.
  - Takes an optional CSV path (default scripts/titles.csv). scripts/holdout.csv
    is a separate labelled set that the rubric is NEVER tuned against. Tune on
    titles.csv, then report the holdout score as the real result.
    Don't start M2 until the holdout result is reported.
  - Rows that fail to score are listed and left out of the %, not counted as
    disagreements.
  - FALLBACK if agreement is under 85% on titles alone: first fix is fetching
    descriptions with the YouTube Data API's videos.list (1 quota unit per call,
    up to 50 IDs per call) and passing them as `description`. Not built yet;
    only build it if M1 needs it.

M2 — Extension MVP. On the YouTube home page: collect video cards as they load,
hide them until scored, send them to the Worker via background.js, then replace
YouTube's feed with my own grid of approved videos (thumbnail, title, channel,
link). Show a loading state while scoring. Options page: invite token, rubric
textarea, strictness threshold.
  - Toolbar popup (added 2026-09-23). Clicking the toolbar icon opens a popup with:
    - interests as chips: type and press Enter to add, click x to remove;
    - the on/off toggle. This replaces "toolbar button toggles on/off": an
      extension action with a popup can't also have its own click handler.
    Interests save to chrome.storage.sync. They feed the scoring prompt now and
    the M3 sourcing searches later. The full rubric and strictness stay on
    the options page.
  - After an interests edit, the cache key (hash of rubric + interests)
    changes, so the feed re-scores automatically. Show a brief "re-scoring…"
    state on the feed (listen to chrome.storage.onChanged).
  - chrome.storage.sync quotas (check at M2): about 8 KB per item and 100 KB
    total, with write-rate limits. Save on Enter/x, not on every keystroke.
  - Home-feed cards have no description, so the model mostly sees title, channel
    and duration. M1 matches that.
  - Channel name is optional for scoring. If the channel can't be read, send the
    title alone; never drop the card.
  - How it works (built):
    - YouTube's cards are hidden with CSS generated from selectors.js.
    - Our #ww-feed sits just above YouTube's grid items, below the topic chips.
    - YouTube's "load more" spinner stays invisible under our grid, so
      scrolling to the end of our grid loads the next page (verified on a
      channel grid with real scrolling).
    - html.ww-hold removes the spinner while a batch is scored, which pauses
      loading.
    - After 120 cards per home visit, loading waits for a "Load more" click.
      This caps scoring cost if nearly everything is being hidden.
    - Plain clicks on a tile call .click() on YouTube's own link, so
      navigation stays in-app.
    - If no card can be read 10s after cards appear, YouTube's feed is
      restored (fail-open). Any unexpected script error does the same.
  - POST /score takes up to 60 items and returns verdicts computed with the
    request's strictness. The model sees items numbered 1..n, never video IDs.
  - WORKER_URL is a constant in background.js (local: http://127.0.0.1:8787).
    host_permissions allow 127.0.0.1:8787 and *.workers.dev; narrow the
    latter to the real subdomain once deployed.
  - Invite tokens: only SHA-256 hashes are stored (invites table). Make one
    with scripts/new-invite.js.

M3 — Sourcing, sidebar, Shorts. If fewer than 10 items are approved, the Worker
searches the YouTube Data API v3 for the user's interests and adds the results
(scored like everything else). Cache search results per query for 24 hours in
D1: each search costs 100 quota units against a default 10,000/day. Filter the
recommendations sidebar on /watch pages. On /shorts, score the current Short
and auto-advance if it fails.

M4 — Behaviour layer.
- Fatigue detection: session over 25 minutes, or 5+ Shorts skipped within
  3 seconds each → overlay offering to switch the filter on.
- Commitment lock: switching on locks the filter for 7 days. Switching off
  early requires a 60-second countdown plus a typed reason.
- Regret rating: on the first YouTube visit after 30+ minutes away, ask
  "Was your last session worth it? 1–5".
- Log to D1: session id, anonymous user id, start time, duration, filter on/off,
  items shown, items hidden, rating.

M5 — Tester build. A script that zips /extension for distribution, a README with
install steps for Chrome and Edge, and a token-protected stats endpoint showing
average rating and sessions per week, filter on vs off.

## D1 free-tier budget (checked against Cloudflare docs, 2026-09-23)
Free plan limits: 100,000 rows written/day, 5M rows read/day, 500 MB per database,
50 queries per Worker invocation, 100 bound parameters per query. Limits
reset at 00:00 UTC. Once a limit is hit, every D1 query errors until the reset
(the default-to-show rule covers this). An index on a written column adds one
extra row written per write.

Worst-case estimate for 50 testers, assuming no cache hits at all:
  home feed   50 × 4 loads × 40 cards        =  8,000
  sidebar     50 × 10 watch pages × 20 recs  = 10,000   (M3)
  Shorts      50 × 50                        =  2,500   (M3)
  session logs                               ~    250   (M4)
  deleting expired cache rows                ~ 20,000   (deletes count as writes)
  total                                      ~ 41,000 / day, well under the 100k limit
Cache hits (the same video appearing again) are reads, not writes, so real use
should come in well below this.

Design rules that keep it cheap:
- Score cache table uses the composite primary key (profile_hash, video_id) as a
  WITHOUT ROWID table, so each write is one row, not two. No extra indexes on it.
- Write a batch of scores in one statement, not one per row. Either insert from
  json_each(?) with a single JSON parameter, or use multi-row VALUES capped at
  100 parameters.
- Check the Workers free-plan request and CPU limits at M2.

## YouTube DOM notes (checked live, signed out, 2026-09-23)
- Cards use the "lockup" layout: ytd-rich-item-renderer > yt-lockup-view-model
  on grids, bare yt-lockup-view-model in the /watch sidebar. The older
  ytd-rich-grid-media layout is still served on some pages (e.g. the Live
  destination page), so both layouts must keep working.
- Live streams: the user's signed-in home feed returned "12K watching" as the
  channel name. On the pages checked signed out, viewer counts do have
  aria-labels, so the signed-in layout differs. Fix: SELECTORS.notChannel
  rejects metadata-looking text (counts, ages, LIVE/Premieres). A bare number
  is still allowed, since channels can be called "47". Assumes an English
  YouTube UI.
- Class names are camelCase now (ytLockupMetadataViewModelTitle, formerly
  yt-lockup-metadata-view-model__title) and change often. Select by tag and
  attribute, not class.
- Title: h3[title] (full, untruncated). Video ID: first a[href*="/watch?v="].
- Channel: first span[role="text"] WITHOUT aria-label inside
  yt-content-metadata-view-model. Views and age spans have aria-labels.
  Channel, views and age may share one row, so never read a whole row.
- Signed out with history off, the home page shows no feed at all ("Your
  YouTube History is off"). Signed-in testers with history paused will see the
  same. There is nothing to filter, so M3 sourcing has to fill it.
- Not yet verified against a signed-in home feed. The export snippet reports
  which selector matched, which is the first place to check.

## Decisions log
2026-09-23
- Project lives at C:\Users\ellio\dev\worthwhile (outside OneDrive), git repo.
- The model returns scores only. show/hide is computed in code (verdictFor), and
  strictness shifts the thresholds.
- Cache key is hash(rubric + interests) + video ID, not user + video ID.
- D1 replaces KV entirely. KV's free plan allows only 1,000 writes/day, and D1
  is already in the stack.
- Scoring uses the official @anthropic-ai/sdk. Callers do
  client.messages.create(buildRequest(...)), so the test and the Worker send
  identical requests.
- Strictness 2 (user's choice from the tuning run; errors were all good
  videos hidden, zero bait through). Frozen for the holdout run.
- Interests move to a toolbar popup (chips + on/off toggle). Rubric and
  strictness stay on the options page.
- The API key is a Windows user environment variable, not .env. Shells
  started before it was set can't see it. Read it from the user environment
  (registry) for that one command, or restart the shell.
- M2: the verdict is computed in the Worker (shared verdictFor with the
  request's strictness), so the extension needs no copy of the rule. The
  cache key is SHA-256 of cacheFingerprint(profile), i.e. model + exact system
  prompt, so wording, rubric or interest changes re-score and strictness
  doesn't.
- M2: on any scoring error the affected cards drop their old verdict and are
  shown, even if they were hidden before (the "Showing everything" notice is
  literally true).

## Local development
- Node 22 (needs >= 20.12 for process.loadEnvFile). `npm install` once in the root.
- `npm run score-test` scores scripts/titles.csv. `npm run score-test -- scripts/holdout.csv`
  scores another file. Add `--dry-run` to show the prompt without calling the API.
- One command for local testing: `npm run dev` from the project root
  (scripts/dev.js). It:
  - installs the Worker's dependencies if missing and applies schema.sql to
    the local D1;
  - creates a local invite token the first time and reuses it after that.
    It's saved in worker/.wrangler/local-invite-token.txt (gitignored), since
    D1 only holds hashes. It registers the token with INSERT OR IGNORE,
    prints it, and copies it to the clipboard;
  - starts the Worker on port 8787 and prints the token again when it's
    ready.
  It refuses to start if port 8787 is busy. If ANTHROPIC_API_KEY isn't in the
  terminal's environment, it reads the Windows user variable directly.
  Stopping it also stops wrangler/workerd, so nothing is left holding the port.
- Worker only, local (no Cloudflare login needed): in /worker, `npm install`
  once, `npm run db:local` once, then `npm run dev`. dev.js passes Windows
  environment variables through (CLOUDFLARE_INCLUDE_PROCESS_ENV), which is how
  ANTHROPIC_API_KEY reaches the local Worker. Don't create a .dev.vars file,
  or that pass-through stops. Wrangler prints env values as "(hidden)".
- Extension: chrome://extensions (or edge://extensions) → Developer mode →
  Load unpacked → the /extension folder. After editing extension files, click
  the reload icon on its card, then reload YouTube.
- Worker free-plan CPU limit is 10 ms per request (network waits don't
  count). Check real usage in the Cloudflare dashboard after deploying.
- Label titles in a spreadsheet and save as "CSV UTF-8" so curly quotes and
  dashes survive. Row numbers in the output match the spreadsheet's row numbers.

## Working style
- Keep code simple and commented. I will be maintaining it.
- You can't see YouTube's live page. If the DOM doesn't match what you expect,
  ask me to paste one video card's HTML from DevTools rather than guessing.
