// extension/shorts-main.js
//
// Runs in YouTube's own page context ("world": "MAIN" in manifest.json),
// because only there can it see YouTube's network responses. It watches for
// one kind: the list of upcoming Shorts (reel_watch_sequence), which YouTube
// fetches before those Shorts play. It READS a copy of that list and passes
// the video IDs (and titles/channels when YouTube includes them) to the
// extension's content scripts with window.postMessage. It never changes what
// YouTube receives.
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
