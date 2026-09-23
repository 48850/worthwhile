// worker/src/index.js
//
// HTTP entry point.
//   POST /score   score a batch of feed items (needs an invite token)
//   GET  /health  liveness check, no token needed
// Plus a daily cron (wrangler.toml) that deletes expired score-cache rows.
//
// POST /score
//   Authorization: Bearer <invite token>
//   { "profile": { "rubric": "...", "interests": ["chess", ...], "strictness": 2 },
//     "items": [{ "id": "<11-char video ID>", "title": "...", "channel": "...", "duration": "12:03" }] }
// → 200 { "results": { "<id>": { "verdict": "show" | "hide", "scores": {...} | null } },
//         "cached": n, "scored": n, "unscored": n }
//   401 bad or missing token, 400 bad request, 503 database unavailable.

import { deleteExpiredScores, scoreItems, sha256Hex } from './score.js';

const LIMITS = {
  items: 60, // per request (up to 3 model calls)
  title: 300,
  channel: 150,
  duration: 12,
  rubric: 5000,
  interests: 30,
  interest: 80,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/health') return json({ ok: true });
      if (pathname === '/score') {
        if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
        return await handleScore(request, env, ctx);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err?.message);
      return json({ error: 'Server error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(deleteExpiredScores(env));
  },
};

async function handleScore(request, env, ctx) {
  let tokenOk;
  try {
    tokenOk = await isValidInvite(request, env);
  } catch (err) {
    // Can't check the token (D1 down or over its daily limit). The extension
    // treats any non-200 as "show everything".
    console.error('Invite check failed:', err?.message);
    return json({ error: 'Service unavailable' }, 503);
  }
  if (!tokenOk) return json({ error: 'Invalid or missing invite token' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const problem = checkBody(body);
  if (problem) return json({ error: problem }, 400);

  const profile = {
    rubric: body.profile.rubric.trim(),
    interests: body.profile.interests.map((i) => i.trim()).filter(Boolean),
    strictness: body.profile.strictness,
  };
  const items = body.items.map((item) => ({
    id: item.id,
    title: item.title.trim(),
    channel: (item.channel || '').trim(),
    duration: (item.duration || '').trim(),
  }));

  return json(await scoreItems(env, ctx, profile, items));
}

// Only the SHA-256 of each token is stored (see schema.sql).
async function isValidInvite(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 200) return false;
  const row = await env.DB.prepare('SELECT 1 FROM invites WHERE token_hash = ?').bind(await sha256Hex(token)).first();
  return row !== null;
}

// Returns a message describing the first problem, or null if the body is fine.
function checkBody(body) {
  const profile = body?.profile;
  if (!profile || typeof profile !== 'object') return 'Missing profile';
  if (typeof profile.rubric !== 'string' || !profile.rubric.trim()) return 'profile.rubric must be a non-empty string';
  if (profile.rubric.length > LIMITS.rubric) return `profile.rubric is over ${LIMITS.rubric} characters`;
  if (!Array.isArray(profile.interests) || profile.interests.length > LIMITS.interests) {
    return `profile.interests must be a list of up to ${LIMITS.interests}`;
  }
  if (profile.interests.some((i) => typeof i !== 'string' || i.length > LIMITS.interest)) {
    return `Each interest must be text of up to ${LIMITS.interest} characters`;
  }
  if (!Number.isInteger(profile.strictness) || profile.strictness < 1 || profile.strictness > 5) {
    return 'profile.strictness must be a whole number from 1 to 5';
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > LIMITS.items) {
    return `items must be a list of 1 to ${LIMITS.items}`;
  }
  for (const item of items) {
    if (typeof item?.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(item.id)) return 'Each item needs an 11-character video id';
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > LIMITS.title) {
      return `Each item needs a title of up to ${LIMITS.title} characters`;
    }
    if (item.channel != null && (typeof item.channel !== 'string' || item.channel.length > LIMITS.channel)) {
      return `channel must be text of up to ${LIMITS.channel} characters`;
    }
    if (item.duration != null && (typeof item.duration !== 'string' || item.duration.length > LIMITS.duration)) {
      return 'duration must be short text like "12:03"';
    }
  }
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
