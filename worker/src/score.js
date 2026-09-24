// worker/src/score.js
//
// Scores feed items for one profile:
//   1. cached scores from D1 (7 days, keyed by profile hash + video ID),
//   2. the model for the rest (batches of BATCH_SIZE, run in parallel),
//   3. saves the new scores, then turns scores into show/hide verdicts.
// Any failure along the way just leaves items unscored, and unscored items
// are shown. The feed is never blanked because of an error.
//
// Privacy: logs contain counts only, never titles or video IDs.

import Anthropic from '@anthropic-ai/sdk';
import { BATCH_SIZE, SHORTS_BATCH_SIZE, buildRequest, buildShortsRequest, cacheFingerprint, parseScores, verdictFor } from '../../shared/prompt.js';

const CACHE_SECONDS = 7 * 24 * 60 * 60;

// profile: { rubric, interests, strictness },
// items: [{ id, title, channel, duration, description? }]
// maxNew: score at most this many uncached items with the model (the rest
// come back unscored; sourcing uses this to spread the cost over calls).
// shorts: score with the Shorts prompt (text plus thumbnail; own cache key).
// prepare: optional async (items) => items, run only on the uncached items
// before the model sees them (Shorts use it to fetch details and thumbnails).
// Items it drops stay unscored.
// Returns { results: { [id]: { verdict, scores } }, cached, scored, unscored }.
export async function scoreItems(env, ctx, profile, items, { maxNew = Infinity, shorts = false, prepare = null } = {}) {
  const profileHash = await sha256Hex(cacheFingerprint(profile, { shorts }));
  const now = Math.floor(Date.now() / 1000);

  const scores = await readCache(env, profileHash, items.map((item) => item.id), now);
  const cached = scores.size;
  const missing = items.filter((item) => !scores.has(item.id));

  let toScore = missing.slice(0, maxNew);
  if (prepare && toScore.length) toScore = await prepare(toScore);
  const fresh = await scoreWithModel(env, profile, toScore, { shorts });
  for (const [id, s] of fresh) scores.set(id, s);
  if (fresh.size) ctx.waitUntil(writeCache(env, profileHash, fresh, now)); // don't make the user wait for the write

  const results = {};
  for (const item of items) {
    const s = scores.get(item.id);
    results[item.id] = { verdict: verdictFor(s, { rule: profile.rule, strictness: profile.strictness }), scores: s || null };
  }
  const summary = { items: items.length, cached, scored: fresh.size, unscored: missing.length - fresh.size };
  console.log(JSON.stringify(summary));
  return { results, ...summary };
}

// Map of video ID -> scores for the IDs already scored for this profile.
// A read failure counts as "nothing cached".
async function readCache(env, profileHash, ids, now) {
  const found = new Map();
  try {
    // json_each(?3) turns one JSON-array parameter into rows, which avoids
    // D1's limit of 100 bound parameters per query.
    const { results } = await env.DB.prepare(
      `SELECT video_id, interest_match, substance, bait FROM scores
       WHERE profile_hash = ?1 AND scored_at > ?2
         AND video_id IN (SELECT value FROM json_each(?3))`,
    )
      .bind(profileHash, now - CACHE_SECONDS, JSON.stringify(ids))
      .all();
    for (const row of results) {
      found.set(row.video_id, { interest_match: row.interest_match, substance: row.substance, bait: row.bait });
    }
  } catch (err) {
    console.error('Cache read failed, scoring everything:', err.message);
  }
  return found;
}

// Saves new scores in one statement. A write failure is only logged.
async function writeCache(env, profileHash, fresh, now) {
  const rows = [...fresh].map(([id, s]) => ({ id, i: s.interest_match, s: s.substance, b: s.bait }));
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO scores (profile_hash, video_id, interest_match, substance, bait, scored_at)
       SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.i'),
              json_extract(value, '$.s'), json_extract(value, '$.b'), ?2
       FROM json_each(?3)`,
    )
      .bind(profileHash, now, JSON.stringify(rows))
      .run();
  } catch (err) {
    console.error('Cache write failed:', err.message);
  }
}

// Map of video ID -> scores for the items the model scored successfully.
async function scoreWithModel(env, profile, items, { shorts = false } = {}) {
  const result = new Map();
  if (items.length === 0) return result;
  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set, so nothing can be scored');
    return result;
  }

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined, // only set for offline testing against a mock
    maxRetries: 2,
    timeout: 25_000, // ms
  });

  const size = shorts ? SHORTS_BATCH_SIZE : BATCH_SIZE;
  const build = shorts ? buildShortsRequest : buildRequest;
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));

  await Promise.all(
    batches.map(async (batch) => {
      // The model sees short numbers as ids, not video IDs: fewer tokens, and
      // video IDs are never sent to the model.
      const numbered = batch.map((item, n) => ({ ...item, id: String(n + 1) }));
      try {
        const response = await client.messages.create(build(profile, numbered));
        const parsed = parseScores(response, numbered);
        numbered.forEach((item, n) => {
          const s = parsed.get(item.id);
          if (s) result.set(batch[n].id, s);
        });
      } catch (err) {
        console.error('Model batch failed:', err?.status ?? '', err?.message);
      }
    }),
  );
  return result;
}

// Daily cron: remove score-cache rows older than 7 days (keeps D1 small).
// (source.js has its own clean-up for search results and quota rows.)
export async function deleteExpiredScores(env) {
  const cutoff = Math.floor(Date.now() / 1000) - CACHE_SECONDS;
  const { meta } = await env.DB.prepare('DELETE FROM scores WHERE scored_at < ?').bind(cutoff).run();
  console.log(JSON.stringify({ expiredScoresDeleted: meta.changes }));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
