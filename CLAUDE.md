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
- M2 (extension MVP): built 2026-09-23; the user confirmed it works on their
  real signed-in feed. Automated checks passed:
  - Worker against a mock API: auth, validation, D1 cache, strictness,
    re-scoring, 3 batches in parallel, model failure, expiry cron.
  - Content script on a mock home page: hiding, grid, hold, late-filled
    cards, re-score, errors, on/off, auto-load cap, fail-open.
  - Popup and options pages.
  - One live Worker → Claude call: all 4 verdicts matched the holdout labels.
  Not yet verified: the real YouTube home feed. In particular, whether
  YouTube's spinner loads the next page when our grid is shorter than the
  window (the test browser couldn't repaint without input).
- M3 (sourcing, sidebar, Shorts, Hidden drawer): built 2026-09-23, waiting for
  the user's manual test. Automated checks passed:
  - Worker /source against mock YouTube + mock Claude: per-call search cap,
    24h query cache, handle lookup once, channel-first round-robin,
    medium/long only, approved only, stale fallback when the budget is out,
    per-tester cap, unit counting, validation.
  - Mock pages: sourced mixing and label, Hidden drawer, "Tell YouTube"
    (10 cap, 1-3 s gaps, Stop, missing-option stop, never automatic), sidebar
    filter, channel recording with a stale-page guard, Shorts auto-skip with
    the 5-in-a-row pause, popup channel list.
  Not yet verified on real YouTube: "Not interested" itself (only exists when
  signed in), sourcing with a real YouTube key, Shorts on a signed-in account.
- M4 onwards: not started. Wait for go-ahead after each milestone.

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
             settings.js (defaults + loadSettings, and the device-only lists
               openedChannels / notInterested, shared by all parts),
             chips.js (interests editor used by popup and options),
             ui.css (popup/options styles; styles.css is injected into YouTube),
             common.js (helpers shared by the content scripts, prefixed ww),
             notinterested.js (YouTube "Not interested" via the card's ⋮ menu),
             watch.js (/watch sidebar filter + records opened channels),
             shorts.js (/shorts auto-skip)
/worker      src/index.js (HTTP, auth, validation), src/score.js (cache + model),
             src/source.js (M3), wrangler.toml, schema.sql, dev.js (local run),
             package.json (wrangler + SDK)
/scripts     new-invite.js: makes an invite token and prints the D1 insert;
             edge-cases.csv: 40-title prompt regression suite (run after
             any prompt change)
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
- verdictFor(scores, { rule, strictness }) applies the rule in code
  (changed 2026-09-24: the product now SUBTRACTS from YouTube's feed):
  - rule "bait" (DEFAULT): hide only if bait >= 6 (BAIT_THRESHOLD).
    Interest and substance never hide anything. Chosen from titles.csv:
    bait >= 5/6/7/8 gave 90/87/80/68% agreement and 2/1/0-1/0 good videos
    hidden; 6 hid only one (an ironic "GET RICH QUICK" critique).
  - rule "strict" (option): the original rule. At strictness 3 it hides if
    bait >= 6, or if interest_match < 4 and substance < 6. Each strictness
    step moves every threshold one point.
  Changing the rule or strictness never needs a re-score.
- The prompt's bait anchor includes (added 2026-09-24): "Judge what the video
  is, not only how its title sounds…" It fixed CGP Grey's "This Video Will
  Make You Angry" (was bait 7), taking the edge-case suite from 97.5% to
  100%, with titles.csv unchanged within noise. "The Talent Of RageBaiting"
  (Joe Bartolozzi) still scores low: from the title alone it reads as
  commentary, so it's left to user corrections. A stronger sentence was
  tried and dropped: it didn't fix it and risked hiding real critiques.
- Corrections (the user's "Show it anyway" / "Wrong call"): the 10 newest go
  into the system prompt as JSON-encoded labelled examples, marked as data.
  They're part of the cache key, so a new correction re-scores.
- Scores vary by about ±1 row between identical runs, even at temperature 0.
- Batch up to 20 items per call. temperature 0.
- Cache scores in D1 for 7 days, keyed by SHA-256(model + system prompt),
  which covers the rubric, interests and corrections. No user ID is stored
  next to a video ID.
- Regression suite: scripts/edge-cases.csv, 40 synthetic titles with labels
  under the default rule. Columns: title, channel, my_verdict, category.
  Categories: prompt injection, sarcasm, clickbait on good channels, good
  content with shouty titles, non-English. RUN IT AFTER ANY PROMPT CHANGE:
  `npm run score-test -- scripts/edge-cases.csv`. Tune only on titles.csv
  and the edge-case suite; the holdout is used up.

Profile format (the options page saves this same shape; scripts/profile.json uses it):
  { "rubric": string, "interests": string[], "rule": "bait"|"strict", "strictness": 1-5 }
  plus, sent by the extension: "examples": [{ title, channel, verdict }] (up to 10)
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

  M3 as built (decisions 2026-09-23):
  - QUOTA CORRECTION: YouTube's docs now give search.list its own bucket of
    100 calls/day per project (1 per call). videos/playlistItems/channels
    share 10,000 units/day. Budgets (wrangler.toml [vars]): 90 searches/day,
    9,000 units/day, 10 searches/day per tester. They're counted in D1
    yt_quota by Pacific-time day; the tester bucket is keyed by a
    token-hash prefix and holds counts only.
  - Sources:
    - Each interest chip gets one search: 50 results, then videos.list for
      details. Up to 2 new searches per /source call.
    - Each channel opened from the grid (up to 20, most recent first) gets
      its newest uploads via the uploads playlist, 2 units. Channels come
      first in the round-robin.
    - Handles are resolved once with channels.list forHandle and stored in
      channel_handles.
  - Only videos of 4 minutes or more; no live or upcoming. Descriptions (300
    chars) are sent to the model for sourced items. Same prompt, rule and
    cache as the feed. At most 60 new model scores per call, and only
    approved videos are returned (max 30).
  - Query results are cached in D1 search_cache for 24h, shared by all users,
    with no user recorded. They're kept 7 days as a fallback when the budget
    is out. The cron deletes older rows.
  - Tiles match YouTube's cards: thumbnail, two-line title, channel,
    "views • age". Feed tiles read views/age from the card (the metadata
    spans with an aria-label); sourced tiles get views/publishedAt from
    videos.list statistics (free). Hovering a feed tile shows its scores.
  - SUPERSEDED 2026-09-24: the grid no longer mixes sourced tiles in. They
    now show as one collapsible "Worth your time" row (max 6) above
    YouTube's grid; see "Home page: in-place filtering" below.
  - Opened channels are stored in chrome.storage.local (device only, max
    20), with Forget in the popup.
    - Feed tiles: watch.js reads the channel from the /watch page once
      ytd-watch-flexy[video-id] matches, with a name-match guard against the
      previous video's details.
    - Sourced tiles already know the channel ID.
    - The Worker receives channel IDs/handles, never watched video IDs.
  - Sidebar: filtered in place (dimmed while pending, hidden on fail). No
    grid of our own.
  - Shorts (changed 2026-09-24 after the user's test: auto-skip felt random
    and took control away, the opposite of the product):
    - OFF by default. The options page has "Label bait in Shorts"
      (setting shortsLabels).
    - When on, a failing Short gets a small "Worthwhile: bait" label over
      the player. NOTHING IS EVER SKIPPED.
    - The title comes from the player's title element or a changed page
      title, never a stale one; if unsure, the Short is not scored.
  - Hidden drawer + "Tell YouTube: not interested":
    - A line under the button reads "This acts on your YouTube account."
    - Runs only on click, up to 10 per click, with 1-3 s random pauses.
    - Clicking again stops it; it also stops after 2 "option not found".
    - The hidden card is given a real size off screen ([data-ww-marking])
      while its ⋮ menu is used. Marked IDs go to chrome.storage.local.
    - Matches the English label "Not interested".
    - Counted as told just before its click, so the "Video removed" notice
      YouTube swaps in stays hidden (never on screen; checked).

  Home page: in-place filtering (changed 2026-09-24 after real use; the
  user's normal feed felt better than our grid, so we subtract from it):
  - No grid of our own. YouTube's grid is filtered in place:
    - Each card is invisible until scored (its slot is kept), so bait never
      flashes. After 1.5 s it's shown regardless.
    - Bait gets data-ww="hide" (display: none), and later cards move up.
    - Every card gets margin 0 / 16px right. YouTube sets margins per
      original column, which misaligned cards by 8px after a hide. Checked
      live: identical layout with nothing hidden, aligned when hiding.
  - Late verdicts never move things under the user's eyes: bait scored
    after its card appeared is hidden only if it's below the screen.
    Otherwise it's "left in place" and listed in the drawer. Corrections and
    settings changes the user makes apply immediately.
  - Batches: on-screen cards first (small batch of 10), up to 3 requests in
    parallel (one after another missed the 1.5 s reveal).
  - Other cards: ads, mixes and playlists are marked shown at once. YouTube
    reuses card elements, so a card holding a new video is re-evaluated.
  - The bar above the grid holds:
    - the status line and a "Hidden (N)" toggle opening the drawer;
    - in the drawer, each hidden video with its scores, "Show it anyway",
      "Tell YouTube: not interested" plus its warning, and the left-in-place
      list;
    - the collapsible "Worth your time" row (max 6 sourced videos, one row
      of YouTube-style tiles; the open/closed state is remembered).
  - "Wrong call" appears on hover at a visible card's top left (YouTube's
    hover preview uses the top right). It hides the card and records
    "should've hidden". Checked live: clickable, doesn't navigate, and the
    rest of the thumbnail still opens the video.
  - Corrections live on the device only (chrome.storage.local
    corrections): { videoId, title, channel, scores, verdict, at }, newest
    20 kept, 10 newest sent as examples. A correction overrides that video's
    verdict, and every other card is re-scored with the new examples (no
    on-screen jumps).
  - Added 2026-09-25, after a day-2 real-feed test found YouTube completely
    unfiltered. Cause: the local Worker wasn't running, and it failed open
    silently.
    - Failing open is now visible. background.js tracks serverStatus
      (session storage). The toolbar badge shows "!" with the tooltip
      "Offline: showing everything". The popup shows a banner and re-checks
      /health each time it opens. The in-page bar says "Offline: showing
      everything".
    - "Hide channel" next to "Wrong call" on hover. The channel name goes in
      sync setting hiddenChannels (max 200, case-insensitive). Its videos
      are hidden instantly, never sent to the model, and hidden in the
      /watch sidebar too. Undo with Unhide on the options page.
    - The Shorts shelf on home is hidden by default (sync setting
      hideShortsShelf, html.ww-no-shorts). It hides any grid section, and
      any single card, containing a /shorts/ link. Not yet checked on a
      signed-in home feed.
    - "It's Just Ragebait Bro." (Joe Bartolozzi) scores bait 10, 3 of 3
      runs, with or without the channel name: hidden once scoring runs.
  - Per-session correction COUNT to D1: deferred to M4, where the session
    log table is designed. Only the count will be sent, never titles.
  - Fail-open: unscored = shown, errors = shown. If no card can be read for
    10 s, or the script throws, the filter switches itself off for the page.

  Shorts, the core of the product (plan changed 2026-09-25; the user decided
  NOT to limit Shorts but to filter them properly). Auto-skip failed because
  it skipped after the Short had started, and titles alone are too thin.
  Phase 1 (test first, like M1):
  - Upcoming Shorts are readable before they play (checked live, signed
    out):
    - #shorts-inner-container holds numbered slots
      .reel-video-in-sequence-new#0..N (13-17 seen). Slot 0 is playing, the
      rest come next in order. Each slot has a thumbnail whose URL holds
      the video ID (readShortsQueue in selectors.js).
    - The source is YouTube's reel_watch_sequence request, whose entries
      list the next Shorts in order.
    - One real swipe matched the prediction; my test browser couldn't
      swipe more.
  - "Collect Shorts" (options page, off by default) records every Short
    swiped to (id, title, channel) in chrome.storage.local collectedShorts
    (max 500). It also checks against the queue snapshot taken 1.5 s into
    the previous Short: queued yes/no and how many slots ahead. The options
    page summarises "listed N of M in advance" and copies CSV:
    video_id, title, channel, my_verdict, queue_check.
  - Still to build: scoring Shorts with a ~320px thumbnail (Haiku image
    input) plus title, hashtags, channel and description (videos.list);
    score-test.js Shorts mode by video ID. Target 85% on a holdout of the
    user's ~90 labelled Shorts (a third bait), split like M1.
  Phase 2 only if Phase 1 passes: pre-score the queue and skip bait before
  it's shown. The choice is between skipping on arrival (player hidden and
  muted; may leak a frame) and filtering reel_watch_sequence at the source
  (cleanest, but it intercepts YouTube's own data: more fragile, and
  further from the spirit of YouTube's terms). Label mode stays as an
  option.

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
- /watch (checked live):
  - The sidebar is ytd-watch-next-secondary-results-renderer, with
    yt-lockup-view-model cards.
  - Current video: ytd-watch-flexy[video-id].
  - Channel: the description info cards link /channel/UC... (works for
    collaborations); ytd-video-owner-renderer ytd-channel-name a gives /@handle
    (none for collaborations, which show an avatar stack).
- /shorts (checked live):
  - One reused ytd-reel-video-renderer. The URL and document.title change per
    Short, and yt-navigate-finish fires per Short.
  - Title: yt-shorts-video-title-view-model. Channel:
    yt-reel-channel-bar-view-model a (/@handle).
  - button[aria-label="Next video"] advances.
- Theme variables (checked live 2026-09-24): YouTube renamed its colours.
  --yt-spec-text-primary etc. no longer exist; they're now
  --yt-sys-color-baseline--text-primary / --text-secondary / --tonal-background.
  This made our grid titles render black on black (user-reported). Fix:
  selectors.js cssVars → our own --ww-* variables, with light fallbacks and
  dark ones under html[dark].
- Grid geometry (checked live): ytd-rich-grid-renderer is a centred flex
  column. #contents holds the cards, with --ytd-rich-grid-items-per-row,
  --ytd-rich-grid-item-margin (16px), --ytd-rich-grid-row-margin (32px) and
  --ytd-rich-grid-content-max-width. A card is width / columns - 16px.
  #ww-feed copies that box (stretch, max-width, right padding of one gap),
  and its tiles matched YouTube's cards to the pixel at 1024px and 1600px.
  Card text: title 500 16px/22px 12px under the thumbnail, channel and
  metadata 14px/20px, channel 2px under the title.
- Card ⋮ menu (checked live, signed out): button[aria-label="More actions"]
  opens a yt-sheet-view-model in ytd-popup-container. Its items are
  yt-list-item-view-model > button[role="menuitem"]. It opens even when the
  card is off screen, and Escape closes it. Signed out there's no "Not
  interested" item.

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
  It also passes YOUTUBE_API_KEY through; without it sourcing is simply off.
  worker/dev.js refuses a busy port too. On Windows wrangler would otherwise
  start a second Worker on the same port, and requests go to either one.
- Wrangler dev hot-reloads Worker code, but environment variables are read
  only at start: restart `npm run dev` after adding or changing a key.
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
