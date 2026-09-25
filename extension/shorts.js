// extension/shorts.js
//
// /shorts pages. Off by default; switched on by "Label bait in Shorts" on
// the options page. When on, each Short is scored as it comes up, and one
// that fails gets a small "Worthwhile: bait" label over the player.
// Nothing is ever skipped: the user stays in control of what they watch.
//
// Failure rule: a scoring error means no label.
//
// "Collect Shorts" (options page, for building a labelled test set): as the
// user swipes, each Short's ID, title and channel are recorded on this
// device, with a check of whether YouTube's upcoming-Shorts list (read from
// its network response by shorts-main.js) had already named it, and how many
// seconds before it played. The options page copies
// them as CSV. This works whether or not the filter itself is on.

(() => {
  const QUEUE_POLL_MS = 500; // backstop to the MutationObserver
  const FORGET_AFTER_MS = 30 * 60 * 1000;
  const MAX_COLLECTED = 500;

  let settings = { ...DEFAULT_SETTINGS };
  const verdicts = new Map(); // shortId -> 'show' | 'hide'
  let lastId = null;

  // Every Short seen in YouTube's upcoming queue, and when it first appeared.
  // Watched continuously (not one snapshot per Short), so fast swipes can't
  // make the check look at an out-of-date queue.
  const firstSeenInQueue = new Map(); // shortId -> ms
  let queueObserver = null;
  let queuePoll = 0;
  let watchingSince = 0;

  // YouTube's own list of upcoming Shorts, read from its network response by
  // shorts-main.js (the more reliable source). Always listening: the first
  // list arrives as the Shorts page loads.
  const firstSeenInSequence = new Map(); // shortId -> ms
  const upcomingDetails = new Map(); // shortId -> { title, channel, description } when YouTube sent them
  // The Short now playing, as YouTube's player reports it (shorts-main.js):
  // id -> { title, channel }. The only title source trusted for a Short.
  const nowPlaying = new Map();
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'worthwhile-main') return;
    if (event.data.type === 'shorts-now') {
      const { id, title, channel } = event.data; // page messages are untrusted: check the shape
      if (typeof id === 'string' && /^[\w-]{11}$/.test(id) && typeof title === 'string' && title.trim()) {
        nowPlaying.set(id, { title: title.trim().slice(0, 300), channel: typeof channel === 'string' ? channel.trim().slice(0, 150) : '' });
        if (nowPlaying.size > 200) nowPlaying.delete(nowPlaying.keys().next().value); // keep it small: oldest out
      }
      return;
    }
    if (event.data.type !== 'shorts-sequence') return;
    const now = Date.now();
    for (const s of Array.isArray(event.data.shorts) ? event.data.shorts : []) {
      if (typeof s?.id !== 'string' || !/^[\w-]{11}$/.test(s.id)) continue; // page messages are untrusted: check the shape
      if (!firstSeenInSequence.has(s.id)) firstSeenInSequence.set(s.id, now);
      const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
      upcomingDetails.set(s.id, { title: text(s.title, 300), channel: text(s.channel, 150), description: text(s.description, 300) });
    }
  });

  loadSettings().then((stored) => {
    settings = stored;
    check();
  });
  document.addEventListener('yt-navigate-finish', () => check());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    if (['rubric', 'interests', 'strictness'].some((key) => key in changes)) verdicts.clear();
    if (['enabled', 'token', 'shortsLabels', 'collectShorts', 'rubric', 'interests', 'strictness'].some((key) => key in changes)) {
      lastId = null; // look at the current Short again with the new settings
      check();
    }
  });

  function isOn() {
    return wwIsActive(settings) && settings.shortsLabels;
  }

  async function check() {
    removeLabel();
    const match = /^\/shorts\/([\w-]{11})/.exec(location.pathname);
    if (!match) {
      stopWatchingQueue();
      return;
    }
    const id = match[1];
    if (id === lastId) return;
    lastId = id;
    const collecting = settings.collectShorts;
    if (collecting) watchQueue();
    else stopWatchingQueue();
    if (!collecting && !isOn()) return;

    // Had this Short already appeared in the queue before it came up?
    // Checked first, before the queue is read again.
    const queueCheck = collecting ? checkQueue(id) : null;
    noteQueue();

    // Title and channel come from YouTube's player, which reports them with
    // the video ID, so they can't belong to a different Short. The page's
    // own title text lags behind on swipes and is not used. No report
    // within 4 s: leave this Short alone.
    let title = 'known';
    let channel = '';
    if (!verdicts.has(id) || collecting) {
      const playing = await wwWaitFor(() => nowPlaying.get(id), 4000);
      if (!playing || location.pathname !== `/shorts/${id}`) return;
      ({ title, channel } = playing);
    }
    if (collecting) await collect({ id, title, channel, ...queueCheck });
    if (!isOn()) return;

    let verdict = verdicts.get(id);
    if (!verdict) {
      const reply = await wwScore([{ id, title: title.slice(0, 300), channel }]);
      verdict = reply?.results?.[id]?.verdict;
      if (verdict !== 'show' && verdict !== 'hide') return; // error: no label
      verdicts.set(id, verdict);
    }
    if (verdict === 'hide' && location.pathname === `/shorts/${id}` && isOn()) showLabel();
  }

  // { queued: 'yes' | 'no' | 'unknown', lead }: whether this Short had
  // already appeared in the queue, and how many seconds before it came up.
  // 'unknown' for the first Short after the watching started (nothing to
  // compare with yet).
  // queued/lead: YouTube's network list of upcoming Shorts (the source we'd
  // pre-score from). queuedDom: the page's own queue, kept for comparison.
  function checkQueue(id) {
    const now = Date.now();
    const lead = (map) => {
      const seen = map.get(id);
      return seen == null || now - seen < 200 ? null : Math.round((now - seen) / 100) / 10; // < 0.2 s: only as it came up
    };
    const network = lead(firstSeenInSequence);
    const dom = lead(firstSeenInQueue);
    // Nothing received yet (e.g. the first Short on a fresh page): can't judge.
    const queued = firstSeenInSequence.size === 0 ? 'unknown' : network != null ? 'yes' : 'no';
    const queuedDom = !watchingSince || now - watchingSince < 1000 ? 'unknown' : dom != null ? 'yes' : 'no';
    return { queued, lead: network, queuedDom };
  }

  // Records every Short now in the queue (first sighting only), and forgets
  // old sightings.
  function noteQueue() {
    const now = Date.now();
    for (const id of readShortsQueue()) if (id && !firstSeenInQueue.has(id)) firstSeenInQueue.set(id, now);
    for (const [id, at] of firstSeenInQueue) if (now - at > FORGET_AFTER_MS) firstSeenInQueue.delete(id);
  }

  function watchQueue() {
    if (queuePoll) return;
    watchingSince = Date.now();
    noteQueue();
    queuePoll = setInterval(noteQueue, QUEUE_POLL_MS);
    const container = document.querySelector(SELECTORS.shortsQueueSlot)?.parentElement;
    if (container) {
      queueObserver = new MutationObserver(noteQueue);
      queueObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }
  }

  function stopWatchingQueue() {
    clearInterval(queuePoll);
    queuePoll = 0;
    queueObserver?.disconnect();
    queueObserver = null;
    watchingSince = 0;
  }

  // Records a Short for the labelled test set (this device only, first sight kept).
  async function collect(entry) {
    const { collectedShorts } = await loadLocal();
    if (collectedShorts.some((s) => s.id === entry.id)) return;
    await chrome.storage.local.set({ collectedShorts: [...collectedShorts, { ...entry, at: Date.now() }].slice(-MAX_COLLECTED) });
  }

  // A small label over the top-left of the player (fixed position, so
  // YouTube's own layout is never touched).
  function showLabel() {
    const player = document.querySelector(SELECTORS.shortsPlayer);
    const rect = player?.getBoundingClientRect();
    const label = wwEl('div', { id: 'ww-shorts-label', text: 'Worthwhile: bait' });
    label.style.top = `${Math.max(rect && rect.height ? rect.top + 12 : 72, 64)}px`;
    label.style.left = `${rect && rect.width ? rect.left + 12 : 24}px`;
    document.documentElement.appendChild(label);
  }

  function removeLabel() {
    document.getElementById('ww-shorts-label')?.remove();
  }
})();
