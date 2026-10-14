# Decisions

Every non-obvious decision, newest first: what was decided, why, and what
it affects. Decisions before 2026-10-14 (M1 to the Chrome + iOS
restructure) are in CLAUDE.md's "Decisions log" until Phase 1's doc
clean-up moves them here.

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
