// worker/src/shorts.js
//
// Scores YouTube Shorts by video ID. The extension sends the IDs of the
// Shorts YouTube is about to play; for each one not already cached this:
//   1. looks up title, channel, tags and description (videos.list, 1 unit
//      per 50 IDs, from the shared daily budget),
//   2. fetches its thumbnail (i.ytimg.com, not part of any quota),
//   3. scores text and image together with the Shorts prompt.
// Same cache, rule and fail-open behaviour as the feed (score.js): a Short
// we can't look up or score comes back unscored, which means "show".
// Privacy: logs contain counts only, never titles or video IDs.

import { shortFromVideo, shortsThumbnailUrl } from '../../shared/prompt.js';
import { scoreItems } from './score.js';
import { DEFAULT_UNITS_PER_DAY, limit, spend, youtube } from './source.js';

const MAX_IMAGE_BYTES = 200_000; // hqdefault is ~10-40 KB; anything bigger is unexpected

// ids: up to 20 video IDs. Returns the same shape as scoreItems.
export async function scoreShorts(env, ctx, profile, ids) {
  const items = ids.map((id) => ({ id }));
  return scoreItems(env, ctx, profile, items, { shorts: true, prepare: (missing) => withDetails(env, missing) });
}

// Adds text and thumbnail to each Short. Drops Shorts with no details
// (deleted, private, or the lookup failed); they stay unscored.
async function withDetails(env, items) {
  if (!env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY is not set, so Shorts can\'t be looked up');
    return [];
  }
  if (!(await spend(env, 'units', 1, limit(env.YOUTUBE_UNITS_PER_DAY, DEFAULT_UNITS_PER_DAY)))) {
    console.error('YouTube daily budget used up, Shorts left unscored');
    return [];
  }
  let data;
  try {
    data = await youtube(env, 'videos', { part: 'snippet', id: items.map((item) => item.id).join(',') });
  } catch (err) {
    console.error('Shorts lookup failed:', err.message);
    return [];
  }
  const byId = new Map((data.items || []).map((v) => [v.id, v]));
  const found = items.filter((item) => byId.has(item.id));
  const images = await Promise.all(found.map((item) => thumbnail(env, item.id)));
  const ready = found.map((item, n) => ({ id: item.id, ...shortFromVideo(byId.get(item.id)), image: images[n] }));
  console.log(JSON.stringify({ shortsLookedUp: items.length, found: ready.length, withImage: images.filter(Boolean).length }));
  return ready.filter((item) => item.title); // a Short needs at least a title to be judged
}

// { mediaType, data (base64) } or null. A missing image just means the
// Short is scored on its text.
async function thumbnail(env, id) {
  try {
    const url = env.THUMBNAIL_BASE ? `${env.THUMBNAIL_BASE}/${id}.jpg` : shortsThumbnailUrl(id); // override only for offline tests
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    return { mediaType, data: base64(bytes) };
  } catch {
    return null;
  }
}

// btoa() needs a binary string; build it in chunks so big arrays don't
// overflow the argument limit of String.fromCharCode.
function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
