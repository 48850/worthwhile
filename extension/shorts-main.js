// extension/shorts-main.js
//
// Runs in YouTube's own page context ("world": "MAIN" in manifest.json),
// because only there can it see YouTube's network responses and player. It
// passes two things to the extension's content scripts (window.postMessage):
//   1. the list of upcoming Shorts (reel_watch_sequence), which YouTube
//      fetches before those Shorts play (or, on a full page load, embeds in
//      the page): a READ-ONLY copy of the video IDs (and titles/channels
//      when YouTube includes them);
//   2. the Short now playing (ID, title, channel) from YouTube's player.
// It never changes what YouTube receives or shows.
// The one YouTube selector outside selectors.js lives here ('#shorts-player'):
// this world can't see selectors.js, and loading it here would add globals
// to YouTube's own page.
//
// Plain script, no extension APIs (none are available in this world). If
// anything here fails, YouTube is unaffected: the original response is
// always returned untouched.

(() => {
  const SEQUENCE_PATH = '/youtubei/v1/reel/reel_watch_sequence';
  const originalFetch = window.fetch;

  window.fetch = function (...args) {
    const response = originalFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
      if (url.includes(SEQUENCE_PATH)) {
        response
          .then((res) => res.clone().json())
          .then(forward)
          .catch(() => {}); // ours only; YouTube still gets its response
      }
    } catch {
      // never let our reading affect YouTube
    }
    return response;
  };

  // On a full page load of /shorts/<id>, YouTube doesn't fetch the first
  // list: it's embedded in the page as ytInitialReelWatchSequenceResponse
  // (checked live 2026-09-26; same shape, starts with the NEXT Short). Read
  // it once per page load; later lists arrive by fetch. The global goes
  // stale after in-page navigation, hence only once.
  let sentInitial = false;
  function forwardInitial() {
    if (sentInitial || !/^\/shorts\//.test(location.pathname)) return;
    try {
      const data = window.ytInitialReelWatchSequenceResponse;
      if (!Array.isArray(data?.entries)) return;
      sentInitial = true;
      forward(data);
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

  // Sends [{ id, title, channel, description }] in the order YouTube will play them.
  function forward(data) {
    const shorts = [];
    for (const entry of data?.entries || []) {
      const endpoint = entry?.command?.reelWatchEndpoint;
      if (!endpoint?.videoId) continue;
      const details = endpoint.unserializedPrefetchData?.playerResponse?.videoDetails; // present for some entries
      shorts.push({
        id: endpoint.videoId,
        title: details?.title || null,
        channel: details?.author || null,
        description: details?.shortDescription || null,
      });
    }
    if (shorts.length) window.postMessage({ source: 'worthwhile-main', type: 'shorts-sequence', shorts }, location.origin);
  }
})();
