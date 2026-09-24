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
// device, with a check of whether YouTube's upcoming-Shorts queue had
// already listed it (and how many slots ahead). The options page copies
// them as CSV. This works whether or not the filter itself is on.

(() => {
  const SNAPSHOT_AFTER_MS = 1500; // read the queue once a Short has settled
  const MAX_COLLECTED = 500;

  let settings = { ...DEFAULT_SETTINGS };
  const verdicts = new Map(); // shortId -> 'show' | 'hide'
  let lastId = null;
  let lastTitle = '';
  let snapshot = { queue: [], current: null }; // the queue as it was while the previous Short played
  let snapshotTimer = 0;

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

  // The player's title element (empty until the Short renders), and the page
  // title ("(3) Title - YouTube"), which starts out generic on a fresh load.
  function panelTitle() {
    return (document.querySelector(SELECTORS.shortsTitle)?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function pageTitle() {
    return document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
  }

  async function check() {
    removeLabel();
    const match = /^\/shorts\/([\w-]{11})/.exec(location.pathname);
    if (!match) return;
    const id = match[1];
    if (id === lastId) return;
    lastId = id;
    const collecting = settings.collectShorts;
    if (!collecting && !isOn()) return;

    // Was this Short in the queue while the previous one played? Checked
    // before anything else, against the snapshot taken back then.
    const queueCheck = collecting ? checkQueue(id) : null;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      if (location.pathname === `/shorts/${id}`) snapshot = { queue: readShortsQueue(), current: id };
    }, SNAPSHOT_AFTER_MS);

    // The title catches up with the new Short a moment after the URL. Only
    // trust a title that belongs to this Short: the player's title once it
    // differs from the last Short's, or the page title once it has changed
    // since this Short came up. If neither, leave the Short alone.
    const titleAtStart = pageTitle();
    let title = verdicts.has(id) && !collecting ? 'known' : null;
    if (!title) {
      title = await wwWaitFor(() => {
        const panel = panelTitle();
        if (panel && panel !== lastTitle) return panel;
        const page = pageTitle();
        if (page && page !== lastTitle && page !== titleAtStart) return page;
        return null;
      }, 4000);
      if (!title || location.pathname !== `/shorts/${id}`) return;
      lastTitle = title;
    }

    const channel = (document.querySelector(SELECTORS.shortsChannel)?.textContent || '').trim();
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

  // { queued: 'yes' | 'no' | 'unknown', ahead }: whether the queue (read
  // while the previous Short played) already listed this one, and how many
  // slots after the previous Short it was (1 = the very next slot).
  function checkQueue(id) {
    if (snapshot.queue.length === 0) return { queued: 'unknown', ahead: null };
    const at = snapshot.queue.indexOf(id);
    if (at === -1) return { queued: 'no', ahead: null };
    const from = snapshot.queue.indexOf(snapshot.current);
    return { queued: 'yes', ahead: from === -1 ? null : at - from };
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
