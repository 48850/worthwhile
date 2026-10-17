# Decisions

Every non-obvious decision, newest first: what was decided, why, and what
it affects. Decisions before 2026-10-14 (M1 to the Chrome + iOS
restructure) are in CLAUDE.md's "Decisions log" until Phase 1's doc
clean-up moves them here.

## 2026-10-14: First eval of classifier v2 (gates not met; stopped for the user)

- **Range moves one threshold on "fit", not on relevance alone (needs the
  user's OK: the brief says "relevance threshold only").** Fit is
  relevance, or for a video outside the user's interests, how good it is
  (0 at the quality floor, up to just under what Range 0 needs). So
  "Only my interests" is unchanged, and sliding right lets in the
  excellent from outside the interests first, then the good, then
  anything above the floor. Why: the user's feed verdicts follow quality
  more than topic. On the tuning set, relevance alone peaked at 81.7%
  (good history, geography, tech and news videos outside the 8 saved
  interests were all "show"); fit reached 91.7-93.3%.
- Prompt v2.1 (commit 9ff17e5) was tuned on titles.csv, edge-cases.csv
  and shorts-tuning.csv only, then run once on the holdouts.

| v2.1                        | Haiku 4.5        | Haiku 5.5 (low, no thinking) |
|-----------------------------|------------------|------------------------------|
| Feed tuning, best Range     | 85.0% at 0.6     | 91.7% at 0.7                 |
| Feed holdout, at that Range | 83.3% (25/30)    | 83.3% (25/30)                |
| Shorts tuning, Range 1      | 83.1%            | 79.7%                        |
| Shorts holdout, Range 1     | 80.8% (21/26)    | 65.4% (17/26)                |
| Edge-case junk P / R        | 100% / 86.7%     | 100% / 100%                  |
| Cost per 1,000 videos       | $0.61            | $0.08                        |

  Haiku 5.5 medium effort (thinking on): feed 93.3%, Shorts 74.6% on
  tuning, $0.11 per 1,000. Scores move by one or two rows between runs.
- Both holdouts are now spent for v2.1. With 30 and 26 rows, each row is
  3-4 points, so the gate needs a bigger, fresh set labelled by the user.
- Open questions put to the user: whether clip channels reposting
  podcasts and creators are junk (the brief says repost farms are; the
  Shorts labels drafted in September said "show"), whether challenge and
  stunt videos are junk or a personal exclusion, and whether Shorts get
  their own Range (feed verdicts fit Range 0.6-0.7, Shorts verdicts fit 1).

## 2026-10-14: Phase 1 of the build brief (user's answers to the audit)

### Product and privacy

- **Classification is profile-free; relevance is computed on the device.**
  The server classifies each video once, for everyone: quality, junk
  category, topics, depth, format and a one-line reason. The extension
  turns that into relevance using the local taste profile.
  Why: the brief wants each video classified once for everyone (§4) and
  the profile kept on the device (§9). A model-scored relevance needs the
  profile in every request and a cache per profile, which breaks both.
  It also makes Range instant (no re-scoring).
  Condition (user): the eval harness reports end-to-end agreement, i.e.
  the final show/cut decision (server classification + on-device
  relevance with the user's profile) against the user's verdicts, not
  only junk precision and recall. Under 85%: stop and show the misses.
- **What leaves the device.** Titles, video IDs and watch history never
  leave it as the user's history. Video IDs and metadata are sent for
  classification with no user identity attached. Anonymous session
  records (counts, durations, Range setting, filter on/off and the "Was
  that worth it?" answer) go to D1 only if the user opts in during
  onboarding, on a screen that states exactly what is sent. Anyone who
  declines gets "Copy my stats" to share by hand.
- **The taste profile lives on the device.** The website hands a profile
  over by import (a file), not through a server copy. This supersedes
  the website brief's plan to serve profiles from Supabase to the
  extension; the website's Phase 2 needs revisiting.
- **No over-fetching** of YouTube's pages or internal API, not even as an
  opt-in experiment. Replacements come from the vetted library and from
  YouTube's own loading as the user scrolls.

### Terms risk (review before any public release)

- **Rewriting YouTube's data responses is accepted for the private pilot**,
  for Shorts (reel_watch_sequence, already done) and for the home feed if
  spike (a) wins. Never touch ads or YouTube branding.
- YouTube's Terms of Service (dated 2023-11-06) forbid accessing the
  Service "using any automated means (such as robots, botnets or
  scrapers)" and anything that would "circumvent, disable, fraudulently
  engage with, or otherwise interfere with any part of the Service".
  Changing YouTube's responses, and in a broad reading changing its page,
  falls under the second.
- The YouTube API Services Developer Policies apply because the server
  uses the Data API:
  - III.E.4: API data may be stored for at most 30 days, then refreshed
    or deleted. This applies to the library and any cached metadata.
  - III.E.4.h: no "new or derived data or metrics" from API data unless
    clearly disclosed as our own. Quality scores must be labelled as
    Worthwhile's, never presented as YouTube's.
  - III.E.6 and III.I.14: an API client must not scrape YouTube or
    retrieve API data by other means. Reading feed items off the page
    into the shared library is in tension with this.
  - III.D.7: undocumented APIs need express permission.
  Fine for a private pilot; needs a proper review (and possibly YouTube's
  approval) before anything public.
- Later phases, to check when they start: an App Store WebView wrapper of
  m.youtube.com (guidelines 4.2 and 5.2.2), Android accessibility
  services (Google Play policy), an on-device proxy (Phase 3, own phone
  only).

### Gates

- **No extension interface work until Shorts reaches 85% on a fresh
  holdout.** If classifier v2 can't get there, stop and show the
  disagreements. (The 26-Short holdout from 2026-09-26 is spent: it was
  run once against the v1 prompt and is now tuning data.)
- **End-to-end agreement of 85% or more** (see above), or stop and show
  the misses.

### Models

- One provider (Anthropic) behind one interface, a fast, cheap model for
  classification.
- Checked against Anthropic's models page on 2026-10-14: Claude Haiku 5.5
  exists (`claude-haiku-5-5`, released 2026-10-07). $0.10 / $0.50 per
  million input / output tokens for prompts up to 100,000 tokens (Haiku
  4.5: $1 / $5). It rejects temperature, top_p and top_k; thinking is
  adaptive and can be switched off (`thinking: {type: "disabled"}`) at
  effort `high` or below; the same text is about 30% more tokens than on
  Haiku 4.5. Haiku 4.5 is now listed as legacy.
- So the comparison is Haiku 4.5 against Haiku 5.5, reporting accuracy
  and cost per run (the user's fallback of Sonnet 5.5 on the disagreement
  set applied only if there were no newer Haiku).

### YouTube Data API quota (checked 2026-10-14, Google's page updated 2026-10-08)

- search.list has its own bucket: 100 calls a day per project, 1 per call.
  Everything else shares 10,000 units a day; videos.list, playlistItems
  and channels cost 1 unit per call (videos.list takes up to 50 IDs).
- So live search per user can't scale. The library grows from uploads of
  curated channels per interest and from videos already being
  classified. The curated channel list per interest is shown to the user
  for approval before seeding.

### Removed, renamed or kept (as recommended in the audit)

- Removed: the commitment lock, the fatigue offers, the "strict" rule and
  strictness (replaced by Range), the 1-5 rating (replaced by "Was that
  worth it?" Yes / Sort of / No), "Label bait in Shorts" (it shows junk
  and then labels it), the "Worth your time" row and /source search
  (replaced by the library).
- Kept: "Tell YouTube: not interested", click-only, moved into the cut
  log. "Collect Shorts" becomes a development-build tool for labelling.
- A session ends when no YouTube tab has been visible for 10 minutes, or
  after 15 minutes without input on a visible one.

### Process

- Back up before any merge, move or delete: a private GitHub repo,
  48850/worthwhile, with every branch pushed.
- Lessons kept from branch wip/effectiveness (to be deleted locally once
  backed up): experiments there reached 84% on Shorts at removal level 6
  with 4-5 of 40 good Shorts removed, but the production code path gave
  77.6% with 10 of 40 removed, and the gap was never explained. So the
  eval harness must build requests with exactly the code the server
  uses. Also tried there: one-letter answer keys, the first screen scored
  as two parallel batches of 5, a 'what' field first for Shorts, the
  thumbnail plus 3 frames (hq1-hq3), and a pace-based hold of 2-6.5 s.
