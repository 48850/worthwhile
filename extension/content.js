// extension/content.js
//
// The home page. Runs on every youtube.com page; YouTube is a single-page
// app, so this one script lives across in-app navigation (yt-navigate-finish).
// (watch.js handles the /watch sidebar, shorts.js handles /shorts.)
//
// On the home page, while the filter is on:
//   1. YouTube's own feed cards are hidden (CSS from selectors.js, html.ww-on).
//   2. Each card YouTube loads is read (selectors.js) and sent in batches to
//      background.js, which asks the Worker for show/hide verdicts.
//   3. Our own grid (#ww-feed) shows the approved videos in feed order, mixed
//      with approved "Sourced" videos (from your interests and from channels
//      you've opened), so the grid is never thin.
//   4. A "Hidden (N)" drawer under the grid lists what was hidden. Its button
//      tells YouTube "Not interested" about up to 10 of them, only when clicked.
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
  const SOURCED_EVERY = 3; // one sourced tile after every 3 feed tiles
  const MIN_TILES = 12; // if the feed has fewer approved videos, sourced ones fill up to this
  const RESOURCE_AFTER_MS = 10 * 60 * 1000; // ask for sourced videos again after 10 minutes
  const TELL_PER_CLICK = 10; // "Not interested": at most this many per click
  const TELL_PAUSE_MS = [1000, 3000]; // random pause between each, like a person

  let settings = { ...DEFAULT_SETTINGS };
  let failedOpen = false; // selectors broke: leave YouTube's feed alone for this page session

  const known = new Map(); // videoId -> { videoId, title, channel, duration, link }
  const verdicts = new Map(); // videoId -> 'show' | 'hide'
  const scoresOf = new Map(); // videoId -> { interest_match, substance, bait }, for the Hidden drawer
  const failed = new Set(); // videoIds whose scoring failed (shown; retried later)
  const queue = new Set(); // videoIds waiting to be sent
  const inFlight = new Set(); // videoIds in the request being scored right now
  const tiles = new Map(); // tile key -> our tile element
  let feedOrder = []; // videoIds currently in YouTube's feed, in order

  let sourced = []; // approved videos from sourcing: [{ id, title, channel, channelId, duration, source }]
  let sourcing = false;
  let sourcedAt = 0;
  let sourcedGeneration = -1;

  let told = new Set(); // videoIds already marked "Not interested" (from chrome.storage.local)
  const tellFailed = new Map(); // videoId -> reason, this page session
  let telling = false;
  let stopTelling = false;
  let tellStatus = '';

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
  let ui = null;
  let lastGridKey = '';
  let lastHiddenKey = '';

  // ---------------------------------------------------------------------------
  // Start-up and navigation
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.id = 'ww-hide-youtube-feed';
  style.textContent = feedHidingCss();
  document.documentElement.appendChild(style);

  Promise.all([loadSettings(), loadLocal()]).then(
    safe(([stored, local]) => {
      settings = stored;
      told = new Set(local.notInterested);
      updateRootClasses();
      onNavigate();
    }),
  );
  document.addEventListener('yt-navigate-finish', safe(onNavigate));
  chrome.storage.onChanged.addListener(safe(onSettingsChanged));

  function isActive() {
    return wwIsActive(settings) && !failedOpen;
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
      stopTelling = true;
      return;
    }
    // Coming back to the home page: retry anything that failed last time.
    for (const id of failed) queue.add(id);
    failed.clear();
    loadLimit = Math.max(loadLimit, feedOrder.length + AUTO_LOAD_CARDS);
    wwWaitFor(() => document.querySelector(`${SELECTORS.homeFeed} ${SELECTORS.gridItems}`), 15000).then(
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
      else known.get(id).link = item.link; // keep the live link element for navigation and the ⋮ menu
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
      if (!sending && queue.size === 0) maybeSource();
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
    const reply = await wwScore(items);
    ids.forEach((id) => inFlight.delete(id));

    if (gen === generation) {
      const results = reply && reply.results;
      for (const id of ids) {
        const result = results && results[id];
        if (result && (result.verdict === 'show' || result.verdict === 'hide')) {
          verdicts.set(id, result.verdict);
          if (result.scores) scoresOf.set(id, result.scores);
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
    if (area === 'local') {
      if (changes.notInterested) told = new Set(changes.notInterested.newValue || []);
      return;
    }
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    updateRootClasses();
    if ('enabled' in changes) onNavigate();
    if (['token', 'rubric', 'interests', 'strictness'].some((key) => key in changes)) scheduleRescore();
  }

  // After a settings change, score every card again (and fetch sourced videos
  // for the new interests). Old verdicts stay on screen, dimmed with
  // "re-scoring…", until the new ones arrive.
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
  // Sourcing: extra approved videos from your interests and opened channels
  // ---------------------------------------------------------------------------

  // Once the feed's first batches are scored, ask for sourced videos. Again
  // after a settings change, or on a later visit once 10 minutes have passed.
  function maybeSource() {
    if (sourcing || !isActive() || !onHome() || feedOrder.length === 0) return;
    if (sourcedGeneration === generation && Date.now() - sourcedAt < RESOURCE_AFTER_MS) return;
    sourcing = true;
    const gen = generation;
    render();
    wwSource()
      .then(
        safe((reply) => {
          if (gen === generation && Array.isArray(reply?.items)) {
            sourced = reply.items;
            sourcedAt = Date.now();
            sourcedGeneration = gen;
          } else if (gen === generation) {
            sourcedAt = Date.now(); // failed: keep what we had, try again later
            sourcedGeneration = gen;
          }
        }),
      )
      .finally(() => {
        sourcing = false;
        render();
      });
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
    const root = wwEl('div', { id: 'ww-feed' });
    const bar = wwEl('div', { className: 'ww-bar' });
    const status = wwEl('span', { className: 'ww-status' });
    bar.append(wwEl('span', { className: 'ww-brand', text: 'Worthwhile' }), status);
    const notice = wwEl('div', { className: 'ww-notice' });
    const grid = wwEl('div', { className: 'ww-grid' });
    const empty = wwEl('div', { className: 'ww-empty' });
    const more = wwEl('button', { className: 'ww-more', text: 'Load more' });
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

    // The Hidden drawer
    const drawer = wwEl('details', { className: 'ww-hidden' });
    const summary = wwEl('summary');
    const tell = wwEl('button', { className: 'ww-tell' });
    tell.type = 'button';
    tell.addEventListener('click', safe(onTellClicked));
    const tellNote = wwEl('span', { className: 'ww-tell-status' });
    const tellRow = wwEl('div', { className: 'ww-tell-row' });
    tellRow.append(tell, tellNote);
    // Testers should know this before they click it.
    const tellWarning = wwEl('div', { className: 'ww-tell-warning', text: 'This acts on your YouTube account.' });
    const list = wwEl('ol', { className: 'ww-hidden-list' });
    drawer.append(summary, tellRow, tellWarning, list);

    root.append(bar, notice, grid, empty, more, drawer);
    return { root, status, notice, grid, empty, more, drawer, summary, tell, tellNote, list };
  }

  function render() {
    if (!ui) return;
    const shown = [];
    const hidden = [];
    let pending = 0;
    for (const id of feedOrder) {
      const verdict = verdicts.get(id) || (failed.has(id) ? 'show' : null);
      if (verdict === 'show') shown.push(id);
      else if (verdict === 'hide') hidden.push(id);
      else pending++;
    }
    const scoring = pending > 0 || sending;

    // Mix sourced videos in: one after every few feed videos, and enough to
    // reach MIN_TILES when the feed itself has few approved videos.
    const inFeed = new Set(feedOrder);
    const extra = sourced.filter((s) => !inFeed.has(s.id) && !told.has(s.id));
    const order = []; // tile keys: "f:<id>" feed, "s:<id>" sourced
    let next = 0;
    shown.forEach((id, i) => {
      order.push(`f:${id}`);
      if ((i + 1) % SOURCED_EVERY === 0 && next < extra.length) order.push(`s:${extra[next++].id}`);
    });
    if (!scoring) while (order.length < MIN_TILES && next < extra.length) order.push(`s:${extra[next++].id}`);
    const sourcedShown = order.filter((key) => key.startsWith('s:')).length;

    // Status line
    const parts = [`${shown.length} shown`, `${hidden.length} hidden`];
    if (sourcedShown) parts.push(`${sourcedShown} sourced`);
    if (rescoring) parts.push('re-scoring…');
    else if (scoring) parts.push(pending ? `scoring ${pending}…` : 'scoring…');
    else if (sourcing) parts.push('finding more…');
    ui.status.textContent = parts.join(' · ');
    ui.root.classList.toggle('ww-busy', scoring || rescoring || sourcing);
    ui.root.classList.toggle('ww-rescoring', rescoring);

    ui.notice.textContent = errorText ? `Showing everything: ${errorText}` : '';
    ui.notice.hidden = !errorText;

    // Tiles (reused between renders so thumbnails don't reload). While the
    // first batch is scored, grey placeholders stand in.
    const placeholders = order.length === 0 && scoring ? PLACEHOLDERS : 0;
    const gridKey = order.join(',') + '|' + placeholders;
    if (gridKey !== lastGridKey) {
      const extraById = new Map(extra.map((s) => [s.id, s]));
      const children = order.map((key) => (key.startsWith('f:') ? feedTile(key.slice(2)) : sourcedTile(extraById.get(key.slice(2)))));
      for (let i = 0; i < placeholders; i++) children.push(wwEl('div', { className: 'ww-tile ww-placeholder' }));
      ui.grid.replaceChildren(...children);
      lastGridKey = gridKey;
    }

    const nothingPassed = feedOrder.length > 0 && order.length === 0 && !scoring && !sourcing;
    ui.empty.textContent = nothingPassed ? 'Nothing loaded so far passed your filter. Scroll down or load more.' : '';
    ui.empty.hidden = !nothingPassed;
    ui.more.hidden = !(feedOrder.length >= loadLimit && !scoring);

    renderHidden(hidden);
  }

  function feedTile(videoId) {
    const key = `f:${videoId}`;
    if (tiles.has(key)) return tiles.get(key);
    const { title, channel, duration } = known.get(videoId);
    const tile = makeTile(videoId, title, channel, duration);
    // Plain click: use YouTube's own link so navigation stays in-app (no
    // page reload). Ctrl/middle-click etc. fall through to the normal href.
    // Either way, note the video so watch.js can record its channel.
    tile.addEventListener('click', (event) => {
      wwOpened.pending = { videoId, channel, at: Date.now() };
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = known.get(videoId)?.link;
      if (link && link.isConnected) {
        event.preventDefault();
        link.click();
      }
    });
    tiles.set(key, tile);
    return tile;
  }

  function sourcedTile(item) {
    const key = `s:${item.id}`;
    if (tiles.has(key)) return tiles.get(key);
    const tile = makeTile(item.id, item.title, item.channel, item.duration);
    tile.classList.add('ww-sourced');
    const from = item.source.startsWith('interest:') ? `your interest "${item.source.slice(9)}"` : 'a channel you\'ve opened';
    tile.title = `${item.title}\nFound by Worthwhile from ${from}`;
    tile.querySelector('.ww-thumb').append(wwEl('span', { className: 'ww-sourced-label', text: 'Sourced' }));
    // Not in YouTube's feed, so no in-app link: a normal page load. Record the
    // channel first (we already know its ID) so the page change can't cut it off.
    tile.addEventListener('click', (event) => {
      const remembered = rememberChannel({ id: item.channelId, name: item.channel });
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      remembered.finally(() => location.assign(tile.href));
    });
    tiles.set(key, tile);
    return tile;
  }

  function makeTile(videoId, title, channel, duration) {
    const tile = wwEl('a', { className: 'ww-tile' });
    tile.href = `/watch?v=${videoId}`;
    tile.title = title;
    const thumb = wwEl('div', { className: 'ww-thumb' });
    const img = wwEl('img');
    img.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
    if (duration) thumb.append(wwEl('span', { className: 'ww-duration', text: duration }));
    tile.append(thumb, wwEl('div', { className: 'ww-title', text: title }), wwEl('div', { className: 'ww-channel', text: channel }));
    return tile;
  }

  // ---------------------------------------------------------------------------
  // The Hidden drawer and "Tell YouTube: not interested"
  // ---------------------------------------------------------------------------

  function renderHidden(hidden) {
    ui.summary.textContent = `Hidden (${hidden.length})`;
    ui.drawer.hidden = hidden.length === 0 && !telling;

    const waiting = hidden.filter((id) => !told.has(id) && !tellFailed.has(id)).length;
    ui.tell.textContent = telling ? 'Stop' : 'Tell YouTube: not interested';
    ui.tell.disabled = !telling && waiting === 0;
    ui.tell.title = telling ? '' : `Marks up to ${TELL_PER_CLICK} of these with YouTube's own "Not interested", one at a time.`;
    ui.tellNote.textContent = tellStatus;

    const key = hidden.map((id) => `${id}:${told.has(id) ? 1 : 0}:${tellFailed.get(id) || ''}`).join(',');
    if (key === lastHiddenKey) return;
    lastHiddenKey = key;
    ui.list.replaceChildren(
      ...hidden.map((id) => {
        const { title, channel } = known.get(id);
        const row = wwEl('li');
        const link = wwEl('a', { text: title });
        link.href = `/watch?v=${id}`;
        const s = scoresOf.get(id);
        const why = s ? `interest ${s.interest_match} · substance ${s.substance} · bait ${s.bait}` : '';
        row.append(link, wwEl('span', { className: 'ww-hidden-meta', text: [channel, why].filter(Boolean).join(' · ') }));
        if (told.has(id)) row.append(wwEl('span', { className: 'ww-told', text: '✓ told YouTube' }));
        else if (tellFailed.has(id)) row.append(wwEl('span', { className: 'ww-told ww-told-failed', text: 'couldn\'t mark' }));
        return row;
      }),
    );
  }

  // One click: up to 10 hidden videos, one at a time, a person-like 1-3 s
  // apart. Clicking again while it runs stops it. Never runs by itself.
  async function onTellClicked() {
    if (telling) {
      stopTelling = true;
      return;
    }
    const targets = feedOrder
      .filter((id) => verdicts.get(id) === 'hide' && !told.has(id) && !tellFailed.has(id))
      .slice(0, TELL_PER_CLICK);
    if (targets.length === 0) return;

    telling = true;
    stopTelling = false;
    let done = 0;
    let missingOption = 0;
    tellStatus = '';
    for (const [i, id] of targets.entries()) {
      if (stopTelling || !onHome()) break;
      tellStatus = `Telling YouTube ${i + 1} of ${targets.length}…`;
      render();

      const link = known.get(id)?.link;
      const card = link && link.isConnected ? cardOf(link) : null;
      const result = card ? await wwTellNotInterested(card) : 'gone';
      if (result === 'ok') {
        done++;
        missingOption = 0;
        told.add(id);
        await rememberNotInterested(id);
      } else {
        tellFailed.set(id, result);
        if (result === 'no-option' || result === 'no-menu') missingOption++;
      }
      if (missingOption >= 2) {
        tellStatus = 'Stopped: couldn\'t find YouTube\'s "Not interested" option. YouTube may have changed its menu.';
        console.warn('Worthwhile: "Not interested" option not found twice in a row; last result:', result);
        break;
      }
      if (i < targets.length - 1 && !stopTelling) {
        const [min, max] = TELL_PAUSE_MS;
        await wwSleep(min + Math.random() * (max - min));
      }
    }
    telling = false;
    if (!tellStatus.startsWith('Stopped')) tellStatus = `Told YouTube about ${done} video${done === 1 ? '' : 's'}.`;
    render();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
