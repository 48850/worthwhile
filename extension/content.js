// extension/content.js
//
// Runs on every youtube.com page. YouTube is a single-page app, so this one
// script lives across in-app navigation (the yt-navigate-finish event).
//
// On the home page, while the filter is on:
//   1. YouTube's own feed cards are hidden (CSS from selectors.js, html.ww-on).
//   2. Each card YouTube loads is read (selectors.js) and sent in batches to
//      background.js, which asks the Worker for show/hide verdicts.
//   3. Our own grid (#ww-feed) shows the approved videos, in feed order.
// YouTube's "load more" spinner stays (invisible) just under our grid, so
// scrolling to the end of our grid makes YouTube load the next page.
// While a batch is being scored, html.ww-hold pauses that loading.
//
// Failure rule: never blank the feed. A scoring error means "show". If no
// card can be read at all, YouTube's own feed is put back.

(() => {
  const BATCH_MAX = 40; // cards per request (the Worker accepts up to 60)
  const SCAN_DELAY_MS = 250; // let YouTube finish adding cards before reading them
  const RESCORE_DELAY_MS = 1200; // let the user finish editing settings before re-scoring
  const FAIL_OPEN_MS = 10000; // no readable card this long after cards appear: give YouTube its feed back
  const AUTO_LOAD_CARDS = 120; // per visit; after this, loading more needs a click (caps scoring cost)
  const PLACEHOLDERS = 8; // grey tiles shown while the first batch is scored

  let settings = { ...DEFAULT_SETTINGS };
  let failedOpen = false; // selectors broke: leave YouTube's feed alone for this page session

  const known = new Map(); // videoId -> { videoId, title, channel, duration, link }
  const verdicts = new Map(); // videoId -> 'show' | 'hide'
  const failed = new Set(); // videoIds whose scoring failed (shown; retried later)
  const queue = new Set(); // videoIds waiting to be sent
  const inFlight = new Set(); // videoIds in the request being scored right now
  const tiles = new Map(); // videoId -> our tile element
  let feedOrder = []; // videoIds currently in YouTube's feed, in order

  let generation = 0; // bumped when settings change, so replies for old settings are ignored
  let sending = false;
  let rescoring = false;
  let errorText = '';
  let loadLimit = AUTO_LOAD_CARDS;

  let observer = null;
  let observedEl = null;
  let scanTimer = 0;
  let rescoreTimer = 0;
  let failOpenTimer = 0;
  let ui = null; // { root, status, notice, grid, more }
  let lastGridKey = '';

  // ---------------------------------------------------------------------------
  // Start-up and navigation
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.id = 'ww-hide-youtube-feed';
  style.textContent = feedHidingCss();
  document.documentElement.appendChild(style);

  loadSettings().then(
    safe((stored) => {
      settings = stored;
      updateRootClasses();
      onNavigate();
    }),
  );
  document.addEventListener('yt-navigate-finish', safe(onNavigate));
  chrome.storage.onChanged.addListener(safe(onSettingsChanged));

  function isActive() {
    return settings.enabled && Boolean(settings.token) && !failedOpen;
  }

  function onHome() {
    return location.pathname === '/';
  }

  function updateRootClasses() {
    document.documentElement.classList.toggle('ww-on', isActive());
  }

  function onNavigate() {
    if (!isActive() || !onHome()) {
      stopObserving();
      return;
    }
    // Coming back to the home page: retry anything that failed last time.
    for (const id of failed) queue.add(id);
    failed.clear();
    loadLimit = Math.max(loadLimit, feedOrder.length + AUTO_LOAD_CARDS);
    waitFor(() => document.querySelector(`${SELECTORS.homeFeed} ${SELECTORS.gridItems}`), 15000).then(
      safe((itemsEl) => {
        if (itemsEl && isActive() && onHome()) startObserving(itemsEl);
      }),
    );
  }

  function startObserving(itemsEl) {
    if (observer) observer.disconnect();
    observedEl = itemsEl;
    // subtree: YouTube adds a card element first and fills it in afterwards.
    observer = new MutationObserver(safe(scheduleScan));
    observer.observe(itemsEl, { childList: true, subtree: true });
    armFailOpen();
    scan();
  }

  function stopObserving() {
    if (observer) observer.disconnect();
    observer = null;
    observedEl = null;
    clearTimeout(failOpenTimer);
    setHold(false);
  }

  // ---------------------------------------------------------------------------
  // Reading YouTube's cards
  // ---------------------------------------------------------------------------

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(safe(scan), SCAN_DELAY_MS);
  }

  function scan() {
    if (!isActive() || !onHome()) return;
    const itemsEl = document.querySelector(`${SELECTORS.homeFeed} ${SELECTORS.gridItems}`);
    if (!itemsEl) return;
    if (itemsEl !== observedEl) {
      startObserving(itemsEl); // YouTube replaced the grid (e.g. a topic chip was clicked)
      return;
    }
    ensureUi(itemsEl);

    const order = [];
    const seen = new Set();
    for (const card of findCards(itemsEl)) {
      const item = readCard(card);
      if (!item || !item.title || seen.has(item.videoId)) continue; // not a video, not filled in yet, or a repeat
      const id = item.videoId;
      seen.add(id);
      order.push(id);
      if (!known.has(id)) known.set(id, item);
      else known.get(id).link = item.link; // keep the live link element for navigation
      if (!verdicts.has(id) && !failed.has(id) && !inFlight.has(id)) queue.add(id);
    }
    feedOrder = order;
    if (order.length) clearTimeout(failOpenTimer);

    render();
    sendNext();
  }

  // If YouTube shows cards but none can be read (selectors out of date),
  // give the user YouTube's own feed back rather than a blank page.
  function armFailOpen() {
    clearTimeout(failOpenTimer);
    failOpenTimer = setTimeout(
      safe(() => {
        const youtubeHasCards = observedEl && observedEl.querySelector(SELECTORS.card);
        if (feedOrder.length === 0 && youtubeHasCards) {
          console.warn('Worthwhile: could not read any video cards, so showing YouTube\'s own feed. selectors.js may need updating.');
          failOpen();
        }
      }),
      FAIL_OPEN_MS,
    );
  }

  function failOpen() {
    failedOpen = true;
    stopObserving();
    updateRootClasses();
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  function sendNext() {
    sendBatch().catch(onUnexpectedError);
  }

  async function sendBatch() {
    if (sending || queue.size === 0 || !isActive()) {
      updateHold();
      return;
    }
    sending = true;
    updateHold();

    const ids = [...queue].slice(0, BATCH_MAX);
    ids.forEach((id) => {
      queue.delete(id);
      inFlight.add(id);
    });
    const items = ids.map((id) => {
      const { title, channel, duration } = known.get(id);
      return { id, title, channel, duration };
    });
    const gen = generation;

    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'score', items });
    } catch {
      reply = { error: 'extension-reloaded' }; // this page's script outlived an extension update
    }
    ids.forEach((id) => inFlight.delete(id));

    if (gen === generation) {
      const results = reply && reply.results;
      for (const id of ids) {
        const verdict = results && results[id] && results[id].verdict;
        if (verdict === 'show' || verdict === 'hide') {
          verdicts.set(id, verdict);
          failed.delete(id);
        } else {
          verdicts.delete(id); // any scoring error means "show", even if an older verdict said hide
          failed.add(id); // retried on the next visit to the home page or settings change
        }
      }
      errorText = results ? '' : describeError(reply && reply.error);
    }
    // (If settings changed mid-request, these ids were already re-queued.)

    sending = false;
    if (queue.size === 0) rescoring = false;
    render();
    sendNext();
  }

  function describeError(code) {
    if (code === 'no-token') return 'Add your invite token in Worthwhile settings.';
    if (code === 'bad-token') return 'Your invite token wasn\'t accepted. Check it in Worthwhile settings.';
    if (code === 'extension-reloaded') return 'Worthwhile was updated. Reload this page.';
    return 'Couldn\'t reach the Worthwhile server.';
  }

  // Pause YouTube's loading while a batch is being scored, and once this
  // visit has loaded its share of cards (the "Load more" button lifts it).
  function updateHold() {
    const busy = sending || queue.size > 0;
    setHold(isActive() && onHome() && (busy || feedOrder.length >= loadLimit));
  }

  function setHold(on) {
    document.documentElement.classList.toggle('ww-hold', on);
  }

  function onSettingsChanged(changes, area) {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    updateRootClasses();
    if ('enabled' in changes) onNavigate();
    if (['token', 'rubric', 'interests', 'strictness'].some((key) => key in changes)) scheduleRescore();
  }

  // After a settings change, score every card again. The old verdicts stay
  // on screen (dimmed, "Re-scoring…") until the new ones arrive.
  function scheduleRescore() {
    generation++;
    rescoring = verdicts.size > 0 || failed.size > 0;
    errorText = '';
    render();
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(
      safe(() => {
        generation++; // ignore replies to requests sent before the edit finished
        for (const id of feedOrder) queue.add(id);
        failed.clear();
        if (queue.size === 0) rescoring = false;
        if (isActive() && onHome()) onNavigate();
        render();
        sendNext();
      }),
      RESCORE_DELAY_MS,
    );
  }

  // ---------------------------------------------------------------------------
  // Our grid
  // ---------------------------------------------------------------------------

  function ensureUi(itemsEl) {
    if (!ui) ui = buildUi();
    // Sit just above YouTube's (hidden) cards, below its topic chips.
    if (ui.root.nextElementSibling !== itemsEl) itemsEl.parentElement.insertBefore(ui.root, itemsEl);
  }

  function buildUi() {
    const root = el('div', { id: 'ww-feed' });
    const bar = el('div', { className: 'ww-bar' });
    const status = el('span', { className: 'ww-status' });
    bar.append(el('span', { className: 'ww-brand', text: 'Worthwhile' }), status);
    const notice = el('div', { className: 'ww-notice' });
    const grid = el('div', { className: 'ww-grid' });
    const empty = el('div', { className: 'ww-empty' });
    const more = el('button', { className: 'ww-more', text: 'Load more' });
    more.type = 'button';
    more.addEventListener(
      'click',
      safe(() => {
        loadLimit = feedOrder.length + 60;
        updateHold();
        render();
        // Nudge the page so YouTube notices its spinner is back in view.
        window.scrollBy(0, 1);
        window.scrollBy(0, -1);
      }),
    );
    root.append(bar, notice, grid, empty, more);
    return { root, status, notice, grid, empty, more };
  }

  function render() {
    if (!ui) return;
    const shown = [];
    let hidden = 0;
    let pending = 0;
    for (const id of feedOrder) {
      const verdict = verdicts.get(id) || (failed.has(id) ? 'show' : null);
      if (verdict === 'show') shown.push(id);
      else if (verdict === 'hide') hidden++;
      else pending++;
    }
    const scoring = pending > 0 || sending;

    // Status line
    const parts = [`${shown.length} shown`, `${hidden} hidden`];
    if (rescoring) parts.push('re-scoring…');
    else if (scoring) parts.push(pending ? `scoring ${pending}…` : 'scoring…');
    ui.status.textContent = parts.join(' · ');
    ui.root.classList.toggle('ww-busy', scoring || rescoring);
    ui.root.classList.toggle('ww-rescoring', rescoring);

    ui.notice.textContent = errorText ? `Showing everything: ${errorText}` : '';
    ui.notice.hidden = !errorText;

    // Tiles (reused between renders so thumbnails don't reload). While the
    // first batch is scored, grey placeholders stand in.
    const placeholders = shown.length === 0 && scoring ? PLACEHOLDERS : 0;
    const key = shown.join(',') + '|' + placeholders;
    if (key !== lastGridKey) {
      const children = shown.map(tileFor);
      for (let i = 0; i < placeholders; i++) children.push(el('div', { className: 'ww-tile ww-placeholder' }));
      ui.grid.replaceChildren(...children);
      lastGridKey = key;
    }

    const nothingPassed = feedOrder.length > 0 && shown.length === 0 && !scoring;
    ui.empty.textContent = nothingPassed ? 'Nothing loaded so far passed your filter. Scroll down or load more.' : '';
    ui.empty.hidden = !nothingPassed;
    ui.more.hidden = !(feedOrder.length >= loadLimit && !scoring);
  }

  function tileFor(videoId) {
    if (tiles.has(videoId)) return tiles.get(videoId);
    const { title, channel, duration } = known.get(videoId);
    const tile = el('a', { className: 'ww-tile' });
    tile.href = `/watch?v=${videoId}`;
    const thumb = el('div', { className: 'ww-thumb' });
    const img = el('img');
    img.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
    if (duration) thumb.append(el('span', { className: 'ww-duration', text: duration }));
    tile.append(thumb, el('div', { className: 'ww-title', text: title }), el('div', { className: 'ww-channel', text: channel }));
    tile.title = title;

    // Plain click: use YouTube's own link so navigation stays in-app (no
    // page reload). Ctrl/middle-click etc. fall through to the normal href.
    tile.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = known.get(videoId)?.link;
      if (link && link.isConnected) {
        event.preventDefault();
        link.click();
      }
    });
    tiles.set(videoId, tile);
    return tile;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Small element builder. Always uses textContent, never innerHTML: titles
  // come from YouTube, and YouTube's page blocks innerHTML anyway.
  function el(tag, { id, className, text } = {}) {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function waitFor(find, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const found = find();
        if (found || Date.now() - start > timeoutMs) resolve(found || null);
        else setTimeout(tick, 200);
      };
      tick();
    });
  }

  // Wraps a callback so an unexpected error puts YouTube's feed back
  // instead of leaving the page blank.
  function safe(fn) {
    return (...args) => {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') result.catch(onUnexpectedError);
        return result;
      } catch (err) {
        onUnexpectedError(err);
      }
    };
  }

  function onUnexpectedError(err) {
    console.error('Worthwhile hit an error and is showing YouTube\'s own feed:', err);
    failOpen();
  }
})();
