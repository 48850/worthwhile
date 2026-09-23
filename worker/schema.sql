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

-- Invite tokens. Only the SHA-256 of each token is stored.
-- Create one with: node scripts/new-invite.js "label"   (from the project root)
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT    NOT NULL PRIMARY KEY,
  label      TEXT,              -- a note for you, e.g. "tester 3"
  created_at INTEGER NOT NULL   -- unix seconds
) WITHOUT ROWID;
