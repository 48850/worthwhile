-- D1 schema. Safe to run more than once.
--   local:   npm run db:local     (from /worker)
--   remote:  npm run db:remote

-- Score cache. One row per (profile, video). profile_hash is the SHA-256 of
-- the model + system prompt (rubric and interests), so no user ID is stored
-- next to a video ID. WITHOUT ROWID makes the primary key the table itself:
-- one row written per score instead of two (free plan: 100k row writes/day).
CREATE TABLE IF NOT EXISTS scores (
  profile_hash   TEXT    NOT NULL,
  video_id       TEXT    NOT NULL,
  interest_match INTEGER NOT NULL,
  substance      INTEGER NOT NULL,
  bait           INTEGER NOT NULL,
  scored_at      INTEGER NOT NULL, -- unix seconds
  PRIMARY KEY (profile_hash, video_id)
) WITHOUT ROWID;

-- Sourcing (M3). One row per YouTube query ("search:<interest>" or
-- "channel:<channel id>"), shared by all users: results don't depend on who
-- asked, and no user is recorded. Fresh for 24 hours, kept 7 days as a
-- fallback for when the daily budget is used up.
CREATE TABLE IF NOT EXISTS search_cache (
  query_key   TEXT    NOT NULL PRIMARY KEY,
  videos_json TEXT    NOT NULL, -- [{ id, title, channel, channelId, duration, description }]
  fetched_at  INTEGER NOT NULL  -- unix seconds
) WITHOUT ROWID;

-- "@handle" -> channel ID, looked up once (channels.list costs 1 unit).
CREATE TABLE IF NOT EXISTS channel_handles (
  handle     TEXT NOT NULL PRIMARY KEY, -- lower case, with the @
  channel_id TEXT NOT NULL
) WITHOUT ROWID;

-- YouTube API usage per quota day (Pacific Time). Buckets: "search" (calls,
-- project-wide), "units" (everything else), "search:<token hash prefix>"
-- (one tester's searches, so nobody can use up everyone's allowance).
CREATE TABLE IF NOT EXISTS yt_quota (
  day    TEXT    NOT NULL, -- YYYY-MM-DD
  bucket TEXT    NOT NULL,
  used   INTEGER NOT NULL,
  PRIMARY KEY (day, bucket)
) WITHOUT ROWID;

-- Invite tokens. Only the SHA-256 of each token is stored.
-- Create one with: node scripts/new-invite.js "label"   (from the project root)
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT    NOT NULL PRIMARY KEY,
  label      TEXT,              -- a note for you, e.g. "tester 3"
  created_at INTEGER NOT NULL   -- unix seconds
) WITHOUT ROWID;

-- Sessions (M4): one row per YouTube session, for measuring whether
-- Worthwhile makes time on YouTube feel better spent. Counts, durations and
-- ratings only: no titles, no video IDs, and no invite token, so a row can't
-- be tied to a tester. user_id is a random ID made by the extension on
-- install. A session ends after 30 minutes away from YouTube; the rating
-- comes later ("Was your last session worth it?"), so rows are upserted.
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT    NOT NULL PRIMARY KEY, -- random, made by the extension
  user_id        TEXT    NOT NULL,             -- random per install
  started_at     INTEGER NOT NULL,             -- unix seconds, to the minute
  duration_s     INTEGER NOT NULL,             -- time with YouTube on screen
  filter_on      INTEGER NOT NULL,             -- 1: on the whole session, 0: off at some point
  items_shown    INTEGER NOT NULL,             -- home feed and sidebar
  items_hidden   INTEGER NOT NULL,
  shorts_seen    INTEGER NOT NULL,
  shorts_removed INTEGER NOT NULL,
  corrections    INTEGER NOT NULL,             -- "Show it anyway" / "Wrong call" clicks
  rating         INTEGER,                      -- 1-5, or NULL if not rated
  saved_at       INTEGER NOT NULL              -- unix seconds
) WITHOUT ROWID;
