// worker/src/index.js
//
// HTTP entry point.
//   POST /score   score a batch of feed items (needs an invite token)
//   POST /source  find extra approved videos for the grid (needs an invite token)
//   GET  /health  liveness check, no token needed
// Plus a daily cron (wrangler.toml) that deletes expired cache rows.
//
// POST /score
//   Authorization: Bearer <invite token>
//   { "profile": { "rubric": "...", "interests": ["chess", ...], "rule": "bait" | "strict", "strictness": 2,
//                  "examples": [{ "title", "channel", "verdict": "show" | "hide" }] (up to 10, optional) },
//     "items": [{ "id": "<11-char video ID>", "title": "...", "channel": "...", "duration": "12:03" }] }
// → 200 { "results": { "<id>": { "verdict": "show" | "hide", "scores": {...} | null } },
//         "cached": n, "scored": n, "unscored": n }
//
// POST /source
//   Authorization: Bearer <invite token>
//   { "profile": { ...as above }, "channels": [{ "id": "UC..." } | { "handle": "@name" }] }
// → 200 { "items": [{ "id", "title", "channel", "channelId", "duration", "views", "publishedAt", "source" }], ... }
//   source is "channel" or "interest:<interest>". Only approved videos are returned.
//
// Errors: 401 bad or missing token, 400 bad request, 503 database unavailable.

import { MAX_EXAMPLES } from '../../shared/prompt.js';
import { deleteExpiredScores, scoreItems, sha256Hex } from './score.js';
import { deleteExpiredSearches, sourceItems } from './source.js';

const LIMITS = {
  items: 60, // per /score request (up to 3 model calls)
  title: 300,
  channel: 150,
  duration: 12,
  rubric: 5000,
  interests: 30,
  interest: 80,
  channels: 20, // per /source request
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/health') return json({ ok: true });
      if (pathname === '/score' || pathname === '/source') {
        if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
        return await handle(pathname, request, env, ctx);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err?.message);
      return json({ error: 'Server error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([deleteExpiredScores(env), deleteExpiredSearches(env)]));
  },
};

async function handle(pathname, request, env, ctx) {
  let tokenHash;
  try {
    tokenHash = await checkInvite(request, env);
  } catch (err) {
    // Can't check the token (D1 down or over its daily limit). The extension
    // treats any non-200 as "show everything".
    console.error('Invite check failed:', err?.message);
    return json({ error: 'Service unavailable' }, 503);
  }
  if (!tokenHash) return json({ error: 'Invalid or missing invite token' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const problem = checkProfile(body?.profile) || (pathname === '/score' ? checkItems(body.items) : checkChannels(body.channels));
  if (problem) return json({ error: problem }, 400);

  const profile = {
    rubric: body.profile.rubric.trim(),
    interests: body.profile.interests.map((i) => i.trim()).filter(Boolean),
    strictness: body.profile.strictness,
    rule: body.profile.rule || 'bait',
    // The user's own corrections (labelled examples). They're part of the
    // prompt, so they're part of the cache key too.
    examples: (body.profile.examples || []).map((e) => ({ title: e.title.trim(), channel: (e.channel || '').trim(), verdict: e.verdict })),
  };

  if (pathname === '/source') {
    const channels = (body.channels || []).map((c) => (c.id ? { id: c.id } : { handle: c.handle }));
    return json(await sourceItems(env, ctx, profile, channels, tokenHash));
  }

  const items = body.items.map((item) => ({
    id: item.id,
    title: item.title.trim(),
    channel: (item.channel || '').trim(),
    duration: (item.duration || '').trim(),
  }));
  return json(await scoreItems(env, ctx, profile, items));
}

// Returns the token's SHA-256 if it's a valid invite, otherwise null.
// Only hashes are stored (see schema.sql).
async function checkInvite(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT 1 FROM invites WHERE token_hash = ?').bind(hash).first();
  return row ? hash : null;
}

// Each check returns a message describing the first problem, or null if fine.
function checkProfile(profile) {
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
  if (profile.rule != null && profile.rule !== 'bait' && profile.rule !== 'strict') return 'profile.rule must be "bait" or "strict"';
  if (profile.examples != null) {
    if (!Array.isArray(profile.examples) || profile.examples.length > MAX_EXAMPLES) {
      return `profile.examples must be a list of up to ${MAX_EXAMPLES}`;
    }
    for (const e of profile.examples) {
      if (typeof e?.title !== 'string' || !e.title.trim() || e.title.length > LIMITS.title) return 'Each example needs a title';
      if (e.channel != null && (typeof e.channel !== 'string' || e.channel.length > LIMITS.channel)) return 'Example channel is too long';
      if (e.verdict !== 'show' && e.verdict !== 'hide') return 'Each example needs verdict "show" or "hide"';
    }
  }
  return null;
}

function checkItems(items) {
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

function checkChannels(channels) {
  if (channels == null) return null;
  if (!Array.isArray(channels) || channels.length > LIMITS.channels) return `channels must be a list of up to ${LIMITS.channels}`;
  for (const c of channels) {
    const okId = typeof c?.id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(c.id);
    const okHandle = typeof c?.handle === 'string' && /^@[\w.-]{1,100}$/.test(c.handle);
    if (!okId && !okHandle) return 'Each channel needs an id ("UC...") or a handle ("@name")';
  }
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
