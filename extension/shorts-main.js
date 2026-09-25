// extension/shorts-main.js
//
// Runs in YouTube's own page context ("world": "MAIN" in manifest.json),
// because only there can it see YouTube's network responses and player.
// It talks to shorts.js (the extension's content script) with
// window.postMessage:
//   1. YouTube's list of upcoming Shorts (reel_watch_sequence). When YouTube
//      fetches a new list, the list is held for up to HOLD_MS while
//      shorts.js scores it, and the Shorts it names as clear bait are taken
//      out before YouTube gets the list. So they never appear. Everything
//      else in the list is left exactly as YouTube sent it.
//      On a full page load the first list is embedded in the page instead:
//      it's passed on (to be scored for later) but can't be changed.
//   2. The Short now playing (ID, title, channel), from YouTube's player.
// The one YouTube selector outside selectors.js lives here ('#shorts-player'):
// this world can't see selectors.js, and loading it here would add globals
// to YouTube's own page.
//
// Plain script, no extension APIs (none are available in this world).
// Failure rule: if anything goes wrong, or shorts.js doesn't answer in
// time, YouTube gets its original response untouched.

(() => {
  const SEQUENCE_PATH = '/youtubei/v1/reel/reel_watch_sequence';
  const HOLD_MS = 3500; // the longest YouTube's next list is held back; shorts.js answers sooner
  const MIN_KEPT = 2; // never leave YouTube a list shorter than this
  const originalFetch = window.fetch;

  window.fetch = function (...args) {
    const request = originalFetch.apply(this, args);
    let url = '';
    try {
      const input = args[0];
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    } catch {
      // unreadable request: not ours
    }
    if (!url.includes(SEQUENCE_PATH)) return request;
    return request.then(filterSequence);
  };

  // The response YouTube gets: its own, or a copy without the removed Shorts.
  async function filterSequence(response) {
    try {
      const data = await response.clone().json();
      const shorts = readShorts(data);
      if (!shorts.length) return response;
      const remove = await askWhichToRemove(shorts);
      // Never take out the Short on screen (the first entry is often the one just opened).
      remove.delete(/^\/shorts\/([\w-]{11})/.exec(location.pathname)?.[1]);
      if (!remove.size) return response;
      const entries = data.entries.filter((entry) => !remove.has(entry?.command?.reelWatchEndpoint?.videoId));
      if (entries.length < MIN_KEPT) return response;
      const removed = shorts.map((s) => s.id).filter((id) => remove.has(id));
      window.postMessage({ source: 'worthwhile-main', type: 'shorts-removed', ids: removed }, location.origin); // for the count
      return new Response(JSON.stringify({ ...data, entries }), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response; // never let our filtering break YouTube
    }
  }

  // Sends the list to shorts.js and resolves with the Set of IDs it says to
  // remove. No answer within HOLD_MS: remove nothing.
  let lastRequestId = 0;
  const waiting = new Map(); // requestId -> resolve
  function askWhichToRemove(shorts) {
    const requestId = ++lastRequestId;
    return new Promise((resolve) => {
      const done = (ids) => {
        clearTimeout(timer);
        waiting.delete(requestId);
        resolve(new Set(ids));
      };
      const timer = setTimeout(() => done([]), HOLD_MS);
      waiting.set(requestId, done);
      window.postMessage({ source: 'worthwhile-main', type: 'shorts-sequence', requestId, shorts }, location.origin);
    });
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'worthwhile-extension' || data.type !== 'shorts-remove') return;
    const ids = Array.isArray(data.remove) ? data.remove.filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)) : [];
    waiting.get(data.requestId)?.(ids);
  });

  // [{ id, title, channel }] in the order YouTube will play them. Titles are
  // only there for some entries.
  function readShorts(data) {
    const shorts = [];
    for (const entry of Array.isArray(data?.entries) ? data.entries : []) {
      const endpoint = entry?.command?.reelWatchEndpoint;
      if (!endpoint?.videoId) continue;
      const details = endpoint.unserializedPrefetchData?.playerResponse?.videoDetails;
      shorts.push({ id: endpoint.videoId, title: details?.title || null, channel: details?.author || null });
    }
    return shorts;
  }

  // On a full page load of /shorts/<id>, YouTube doesn't fetch the first
  // list: it's embedded in the page as ytInitialReelWatchSequenceResponse
  // (checked live 2026-09-26; same shape, starts with the NEXT Short). It
  // can't be held back, so it's only passed on to be scored. Read once per
  // page load: the global goes stale after in-page navigation.
  let sentInitial = false;
  function forwardInitial() {
    if (sentInitial || !/^\/shorts\//.test(location.pathname)) return;
    try {
      const shorts = readShorts(window.ytInitialReelWatchSequenceResponse);
      if (!shorts.length) return;
      sentInitial = true;
      window.postMessage({ source: 'worthwhile-main', type: 'shorts-sequence', shorts }, location.origin); // no requestId: nothing to answer
    } catch {
      // not there; the fetched lists still work
    }
  }
  document.addEventListener('DOMContentLoaded', forwardInitial);
  document.addEventListener('yt-navigate-finish', forwardInitial);

  // The Short now playing, straight from YouTube's player: its video ID and
  // title always belong together (the page's own title text can lag a Short
  // behind, which once mislabelled a whole run of collected Shorts). Sent
  // only once the player has caught up with the URL; tried a few times.
  const NOW_PLAYING_TRIES_MS = [0, 300, 1000, 2500];
  document.addEventListener('yt-navigate-finish', () => {
    const want = /^\/shorts\/([\w-]{11})/.exec(location.pathname)?.[1];
    if (!want) return;
    let sent = false;
    for (const delay of NOW_PLAYING_TRIES_MS) {
      setTimeout(() => {
        if (sent || location.pathname !== `/shorts/${want}`) return;
        try {
          const data = document.querySelector('#shorts-player')?.getVideoData?.();
          if (data?.video_id !== want || !data.title) return;
          sent = true;
          window.postMessage({ source: 'worthwhile-main', type: 'shorts-now', id: want, title: data.title, channel: data.author || '' }, location.origin);
        } catch {
          // player not ready or changed; the next try (or none) will do
        }
      }, delay);
    }
  });
})();
