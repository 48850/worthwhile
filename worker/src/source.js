// worker/src/source.js
//
// Sourcing (M3): finds extra videos worth showing, so the grid is never thin
// even when YouTube's own feed is mostly bait. Two sources:
//   1. Channels the user opened from the grid (the strongest signal of what
//      they value): each channel's newest uploads.
//      Cost: playlistItems.list + videos.list = 2 units.
//   2. The user's interests: one YouTube search per interest.
//      Cost: 1 search.list call (search has its own bucket: 100 calls/day
//      for the whole project) + videos.list = 1 unit.
// Only medium and long videos (4 minutes or more) are kept, and no live or
// upcoming streams.
//
// Every query's results are cached in D1 for 24 hours and shared by all
// users (search results don't depend on who asks). When today's budget is
// used up, results up to 7 days old are used instead of nothing.
//
// Candidates are scored with the same prompt and rule as the feed, and only
// approved ones are returned. Any failure just means fewer sourced videos.
// Privacy: logs contain counts only, never channels, queries or video IDs.

import { scoreItems } from './score.js';

const FRESH_SECONDS = 24 * 60 * 60; // refetch a query after this
const KEEP_SECONDS = 7 * 24 * 60 * 60; // use older results this long when the budget is out
const MIN_SECONDS = 240; // YouTube's "short" is under 4 minutes; keep medium and long
const PER_CHANNEL = 8; // newest qualifying uploads per channel
const PER_SEARCH = 15; // best qualifying results per interest
const NEW_SEARCHES_PER_CALL = 2; // spread the 100 daily searches across calls and users
const NEW_CHANNELS_PER_CALL = 6;
const MAX_NEW_SCORES = 60; // model-scored per call; the rest are scored on later calls
const MAX_RETURN = 30;

// Defaults if wrangler.toml [vars] doesn't set them.
const DEFAULT_SEARCHES_PER_DAY = 90; // of YouTube's 100/day search bucket, leaving a margin
const DEFAULT_UNITS_PER_DAY = 9000; // of the 10,000 units/day for everything else
const DEFAULT_SEARCHES_PER_TESTER = 10; // so one tester can't use up everyone's searches

// profile: { rubric, interests, strictness }
// channels: [{ id: "UC..." } or { handle: "@name" }], most recently opened first
// tokenHash: identifies the tester, only for their daily search allowance.
export async function sourceItems(env, ctx, profile, channels, tokenHash) {
  if (!env.YOUTUBE_API_KEY) return { items: [], note: 'YOUTUBE_API_KEY is not set, so sourcing is off' };

  const now = Math.floor(Date.now() / 1000);
  const allowance = { searches: NEW_SEARCHES_PER_CALL, channels: NEW_CHANNELS_PER_CALL };
  const groups = []; // [{ source, videos }], channels first
  let fetched = 0;

  for (const channel of channels) {
    const channelId = channel.id || (await resolveHandle(env, channel.handle));
    if (!channelId) continue;
    const videos = await cachedQuery(env, `channel:${channelId}`, now, async () => {
      if (allowance.channels <= 0 || !(await spend(env, 'units', 2, limit(env.YOUTUBE_UNITS_PER_DAY, DEFAULT_UNITS_PER_DAY)))) return null;
      allowance.channels--;
      fetched++;
      return fetchChannelUploads(env, channelId);
    });
    if (videos?.length) groups.push({ source: 'channel', videos: videos.slice(0, PER_CHANNEL) });
  }

  for (const interest of profile.interests) {
    const videos = await cachedQuery(env, `search:${interest.toLowerCase()}`, now, async () => {
      if (allowance.searches <= 0) return null;
      // Project-wide budget first, then the tester's own allowance; if the
      // tester is over theirs, give the project-wide search back.
      const perDay = limit(env.YOUTUBE_SEARCHES_PER_DAY, DEFAULT_SEARCHES_PER_DAY);
      if (!(await spend(env, 'search', 1, perDay))) return null;
      const perTester = limit(env.YOUTUBE_SEARCHES_PER_TESTER, DEFAULT_SEARCHES_PER_TESTER);
      if (!(await spend(env, `search:${tokenHash.slice(0, 16)}`, 1, perTester))) {
        await spend(env, 'search', -1, perDay);
        return null;
      }
      if (!(await spend(env, 'units', 1, limit(env.YOUTUBE_UNITS_PER_DAY, DEFAULT_UNITS_PER_DAY)))) return null;
      allowance.searches--;
      fetched++;
      return fetchSearch(env, interest);
    });
    if (videos?.length) groups.push({ source: `interest:${interest}`, videos: videos.slice(0, PER_SEARCH) });
  }

  // Take one from each source in turn, so no single source dominates.
  const candidates = [];
  const seen = new Set();
  for (let i = 0; groups.some((g) => i < g.videos.length); i++) {
    for (const group of groups) {
      const video = group.videos[i];
      if (video && !seen.has(video.id)) {
        seen.add(video.id);
        candidates.push({ ...video, source: group.source });
      }
    }
  }

  const scored = await scoreItems(
    env,
    ctx,
    profile,
    candidates.map((v) => ({ id: v.id, title: v.title, channel: v.channel, duration: v.duration, description: v.description })),
    { maxNew: MAX_NEW_SCORES },
  );
  const items = candidates
    .filter((v) => scored.results[v.id].scores && scored.results[v.id].verdict === 'show')
    .slice(0, MAX_RETURN)
    .map(({ id, title, channel, channelId, duration, source }) => ({ id, title, channel, channelId, duration, source }));

  console.log(JSON.stringify({ sourcing: { queries: groups.length, fetched, candidates: candidates.length, approved: items.length } }));
  return { items, candidates: candidates.length, unscored: scored.unscored };
}

// ---------------------------------------------------------------------------
// Query cache (D1 table search_cache)
// ---------------------------------------------------------------------------

// Returns the query's videos: fresh from the cache, or fetched (and cached)
// if `fetch` is allowed to run, or older cached results as a fallback.
async function cachedQuery(env, key, now, fetch) {
  let row = null;
  try {
    row = await env.DB.prepare('SELECT videos_json, fetched_at FROM search_cache WHERE query_key = ?').bind(key).first();
  } catch (err) {
    console.error('Search cache read failed:', err.message);
  }
  if (row && now - row.fetched_at < FRESH_SECONDS) return JSON.parse(row.videos_json);

  let videos = null;
  try {
    videos = await fetch();
  } catch (err) {
    console.error('YouTube request failed:', err.message);
  }
  if (videos) {
    try {
      await env.DB.prepare('INSERT OR REPLACE INTO search_cache (query_key, videos_json, fetched_at) VALUES (?, ?, ?)')
        .bind(key, JSON.stringify(videos), now)
        .run();
    } catch (err) {
      console.error('Search cache write failed:', err.message);
    }
    return videos;
  }
  if (row && now - row.fetched_at < KEEP_SECONDS) return JSON.parse(row.videos_json); // budget out: older is better than nothing
  return null;
}

// ---------------------------------------------------------------------------
// Daily budgets (D1 table yt_quota). YouTube's quota day starts at midnight
// Pacific Time, so ours does too.
// ---------------------------------------------------------------------------

// Records `amount` against today's `bucket` if that keeps it within `max`.
// Returns false (and records nothing) if it would go over.
async function spend(env, bucket, amount, max) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); // YYYY-MM-DD
  try {
    const { meta } = await env.DB.prepare(
      `INSERT INTO yt_quota (day, bucket, used) VALUES (?1, ?2, ?3)
       ON CONFLICT (day, bucket) DO UPDATE SET used = used + ?3 WHERE used + ?3 <= ?4`,
    )
      .bind(day, bucket, amount, max)
      .run();
    return meta.changes > 0;
  } catch (err) {
    console.error('Quota check failed:', err.message);
    return false; // can't count, so don't spend
  }
}

function limit(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Daily cron: drop search results and quota rows nobody will use again.
export async function deleteExpiredSearches(env) {
  const now = Math.floor(Date.now() / 1000);
  const cache = await env.DB.prepare('DELETE FROM search_cache WHERE fetched_at < ?').bind(now - KEEP_SECONDS).run();
  const cutoffDay = new Date((now - KEEP_SECONDS) * 1000).toISOString().slice(0, 10);
  const quota = await env.DB.prepare('DELETE FROM yt_quota WHERE day < ?').bind(cutoffDay).run();
  console.log(JSON.stringify({ expiredSearchesDeleted: cache.meta.changes, oldQuotaRowsDeleted: quota.meta.changes }));
}

// ---------------------------------------------------------------------------
// YouTube Data API v3
// ---------------------------------------------------------------------------

async function youtube(env, path, params) {
  const base = env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3'; // override only for offline tests
  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: env.YOUTUBE_API_KEY })) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    let reason = '';
    try {
      reason = (await response.json()).error?.errors?.[0]?.reason || '';
    } catch {
      // no JSON body
    }
    throw new Error(`YouTube ${path} ${response.status} ${reason}`); // e.g. quotaExceeded, keyInvalid
  }
  return response.json();
}

async function fetchSearch(env, query) {
  const data = await youtube(env, 'search', { part: 'snippet', type: 'video', maxResults: 50, q: query });
  return videoDetails(env, (data.items || []).map((item) => item.id?.videoId).filter(Boolean));
}

// A channel's uploads playlist ID is its channel ID with "UC" swapped for "UU".
async function fetchChannelUploads(env, channelId) {
  const data = await youtube(env, 'playlistItems', { part: 'contentDetails', playlistId: 'UU' + channelId.slice(2), maxResults: 25 });
  return videoDetails(env, (data.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean));
}

// Full details for up to 50 videos, keeping order, dropping Shorts-length,
// live and upcoming videos.
async function videoDetails(env, ids) {
  if (ids.length === 0) return [];
  const data = await youtube(env, 'videos', { part: 'snippet,contentDetails', id: ids.slice(0, 50).join(',') });
  const byId = new Map((data.items || []).map((v) => [v.id, v]));
  const videos = [];
  for (const id of ids) {
    const v = byId.get(id);
    if (!v || v.snippet?.liveBroadcastContent !== 'none') continue;
    const seconds = isoSeconds(v.contentDetails?.duration);
    if (seconds < MIN_SECONDS) continue;
    videos.push({
      id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      channelId: v.snippet.channelId,
      duration: clock(seconds),
      description: (v.snippet.description || '').replace(/\s+/g, ' ').slice(0, 300),
    });
  }
  return videos;
}

// "@name" -> "UC..." via channels.list (1 unit), remembered in D1 for good.
async function resolveHandle(env, handle) {
  if (!handle) return null;
  try {
    const row = await env.DB.prepare('SELECT channel_id FROM channel_handles WHERE handle = ?').bind(handle.toLowerCase()).first();
    if (row) return row.channel_id;
    if (!(await spend(env, 'units', 1, limit(env.YOUTUBE_UNITS_PER_DAY, DEFAULT_UNITS_PER_DAY)))) return null;
    const data = await youtube(env, 'channels', { part: 'id', forHandle: handle });
    const channelId = data.items?.[0]?.id;
    if (!channelId) return null;
    await env.DB.prepare('INSERT OR REPLACE INTO channel_handles (handle, channel_id) VALUES (?, ?)').bind(handle.toLowerCase(), channelId).run();
    return channelId;
  } catch (err) {
    console.error('Handle lookup failed:', err.message);
    return null;
  }
}

// "PT1H2M3S" -> 3723
function isoSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

// 3723 -> "1:02:03", 245 -> "4:05"
function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
