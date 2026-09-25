// extension/watch.js
//
// /watch pages, while the filter is on:
//   1. The recommendations sidebar is filtered in place: each card is dimmed
//      until scored, then hidden if it fails (CSS from selectors.js, keyed on
//      data-ww-verdict). A vertical list has no gaps to fill, so unlike the
//      home page there is no grid of our own.
//   2. When the video was opened from our home grid, its channel is recorded
//      (on this device only) so sourcing can search that channel's uploads.
//
// Failure rule: a scoring error means "show".

(() => {
  const BATCH_MAX = 40;
  const SCAN_DELAY_MS = 300;

  let settings = { ...DEFAULT_SETTINGS };
  const verdicts = new Map(); // videoId -> 'show' | 'hide' (this page session)
  const queue = new Map(); // videoId -> item waiting to be sent
  const inFlight = new Set();
  let sending = false;
  let generation = 0;
  let observer = null;
  let observedEl = null;
  let scanTimer = 0;

  loadSettings().then((stored) => {
    settings = stored;
    onNavigate();
  });
  document.addEventListener('yt-navigate-finish', onNavigate);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    if (changes.hiddenChannels) scan();
    if (['enabled', 'token', 'rubric', 'interests', 'rule', 'strictness'].some((key) => key in changes)) {
      generation++;
      verdicts.clear();
      queue.clear();
      clearMarks();
      onNavigate();
    }
  });

  function onWatch() {
    return location.pathname === '/watch';
  }

  function onNavigate() {
    recordOpenedChannel().catch((err) => console.warn('Worthwhile: could not record the channel:', err));
    if (!wwIsActive(settings) || !onWatch()) {
      if (observer) observer.disconnect();
      observer = null;
      observedEl = null;
      return;
    }
    wwWaitFor(() => document.querySelector(SELECTORS.sidebar), 15000).then((sidebar) => {
      if (sidebar && wwIsActive(settings) && onWatch()) observe(sidebar);
    });
  }

  function observe(sidebar) {
    if (observer) observer.disconnect();
    observedEl = sidebar;
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, SCAN_DELAY_MS);
    });
    observer.observe(sidebar, { childList: true, subtree: true });
    scan();
  }

  // Marks every readable sidebar card with its verdict (or "pending") and
  // queues unscored ones.
  function scan() {
    const sidebar = document.querySelector(SELECTORS.sidebar);
    if (!sidebar || !wwIsActive(settings) || !onWatch()) return;
    if (sidebar !== observedEl) return observe(sidebar);
    for (const card of findCards(sidebar)) {
      const item = readCard(card);
      if (!item || !item.title) continue; // mixes, playlists, ads, unfilled cards: left alone
      const channel = item.channel.toLowerCase();
      const channelHidden = channel !== '' && settings.hiddenChannels.some((c) => c.toLowerCase() === channel);
      const verdict = channelHidden ? 'hide' : verdicts.get(item.videoId) || 'pending';
      if (card.getAttribute('data-ww-verdict') !== verdict) card.setAttribute('data-ww-verdict', verdict);
      if (verdict !== 'pending') wwTally(verdict === 'hide' ? 'hidden' : 'shown', item.videoId);
      if (verdict === 'pending' && !inFlight.has(item.videoId)) queue.set(item.videoId, item);
    }
    send();
  }

  async function send() {
    if (sending || queue.size === 0) return;
    sending = true;
    const batch = [...queue.values()].slice(0, BATCH_MAX);
    batch.forEach((item) => {
      queue.delete(item.videoId);
      inFlight.add(item.videoId);
    });
    const gen = generation;
    const reply = await wwScore(batch.map(({ videoId, title, channel, duration }) => ({ id: videoId, title, channel, duration })));
    batch.forEach((item) => inFlight.delete(item.videoId));
    if (gen === generation) {
      for (const item of batch) {
        const verdict = reply?.results?.[item.videoId]?.verdict;
        verdicts.set(item.videoId, verdict === 'hide' ? 'hide' : 'show'); // errors mean "show"
      }
    }
    sending = false;
    scan(); // apply verdicts, and send anything that arrived meanwhile
  }

  function clearMarks() {
    for (const card of document.querySelectorAll('[data-ww-verdict]')) card.removeAttribute('data-ww-verdict');
  }

  // If this video was opened from our home grid (content.js set
  // wwOpened.pending), remember its channel once the page shows it.
  async function recordOpenedChannel() {
    const pending = wwOpened.pending;
    if (!pending || !onWatch()) return;
    const videoId = new URLSearchParams(location.search).get('v');
    if (videoId !== pending.videoId || Date.now() - pending.at > 60000) return;
    wwOpened.pending = null;

    // YouTube updates the page in place, so wait until it's showing this
    // video, then a moment more for the channel details to catch up.
    const ready = await wwWaitFor(() => document.querySelector(`${SELECTORS.watchPage}[video-id="${videoId}"]`), 10000);
    if (!ready) return;
    await wwSleep(1500);
    if (new URLSearchParams(location.search).get('v') !== videoId) return;
    const channel = readWatchChannel();
    if (!channel) return;
    // Guard against reading the previous video's channel: when both names
    // are known they must overlap (collaborations list several channels).
    const a = (channel.name || '').toLowerCase();
    const b = (pending.channel || '').toLowerCase();
    if (a && b && !a.includes(b) && !b.includes(a)) return;
    await rememberChannel({ ...(channel.id ? { id: channel.id } : { handle: channel.handle }), name: channel.name || pending.channel });
  }
})();
