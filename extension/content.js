// extension/content.js
//
// The home page. Runs on every youtube.com page; YouTube is a single-page
// app, so this one script lives across in-app navigation (yt-navigate-finish).
// (watch.js handles the /watch sidebar, shorts.js handles /shorts.)
//
// Worthwhile SUBTRACTS from YouTube's own home grid; it never replaces it.
// While the filter is on:
//   1. Each card stays invisible (keeping its slot) until it's scored, so
//      bait never flashes. After 1.5 s it's shown anyway, scored or not.
//   2. Bait is removed from the grid; everything else stays exactly where
//      YouTube put it (the CSS in selectors.js keeps the columns aligned).
//   3. A verdict that arrives after a card is already showing only removes
//      it if it's below the screen, so nothing vanishes under your eyes.
//      Otherwise it's "left in place" and listed in the drawer.
//   4. A small bar above the grid holds the "Hidden (N)" drawer (with "Show
//      it anyway" and "Tell YouTube: not interested") and a collapsible
//      "Worth your time" row of up to 6 sourced videos.
//   5. Hovering a visible card shows "Wrong call", which hides it.
// Both corrections are remembered on this device and sent with future
// scoring as labelled examples (see settings.js).
//
// Failure rule: never worse than plain YouTube. Unscored means shown; a
// scoring error means shown; if no card can be read, or the script hits an
// error, the filter switches itself off for the page.

(() => {
  const FIRST_BATCH = 10; // the cards on screen first, in a small batch, for speed
  const BATCH_MAX = 40; // after that, up to this many per request (the Worker accepts 60)
  const MAX_PARALLEL = 3; // requests at once
  const SCAN_DELAY_MS = 50; // cards stay invisible while waiting, so read them quickly
  // Show a card after this long even if it isn't scored yet. The first
  // screen's verdicts take ~1.5-2 s (the Worker scores FIRST_BATCH in two
  // parallel batches of 5); 1.5 s let bait slip onto the first screen.
  const REVEAL_AFTER_MS = 2500;
  const RESCORE_DELAY_MS = 1200; // let the user finish editing settings before re-scoring
  const FAIL_OPEN_MS = 10000; // no readable card this long after cards appear: switch off
  const WORTH_MAX = 6; // "Worth your time" row
  const RESOURCE_AFTER_MS = 10 * 60 * 1000; // ask for sourced videos again after 10 minutes
  const TELL_PER_CLICK = 10; // "Not interested": at most this many per click
  const TELL_PAUSE_MS = [1000, 3000]; // random pause between each, like a person

  let settings = { ...DEFAULT_SETTINGS };
  let failedOpen = false;

  const known = new Map(); // videoId -> { videoId, title, channel, duration, meta, link }
  const cardFor = new Map(); // videoId -> YouTube's card element
  const idOnCard = new WeakMap(); // card element -> videoId it was marked for (YouTube reuses cards)
  const firstSeen = new WeakMap(); // card element -> when it first appeared
  const verdicts = new Map(); // videoId -> 'show' | 'hide', from scoring
  const scoresOf = new Map(); // videoId -> { interest_match, substance, bait }
  const overrides = new Map(); // videoId -> 'show' | 'hide', from the user's corrections
  const failed = new Set(); // videoIds whose scoring failed (shown; retried later)
  const leftInPlace = new Set(); // bait scored after it was already on screen
  const queue = new Set();
  const inFlight = new Set();
  let feedOrder = []; // videoIds currently in YouTube's grid, in order

  let sourced = [];
  let sourcing = false;
  let sourcedAt = 0;
  let sourcedGeneration = -1;
  let worthOpen = true;

  let told = new Set(); // videoIds already marked "Not interested"
  const tellFailed = new Map();
  let telling = false;
  let stopTelling = false;
  let tellStatus = '';

  let generation = 0; // bumped when settings change; replies for old settings are ignored
  let forceGeneration = -1; // replies for this generation may hide on-screen cards (the user changed settings)
  let sending = 0; // requests in flight
  let errorText = '';
  let drawerOpen = false;

  let observer = null;
  let observedEl = null;
  let scanTimer = 0;
  let revealTimer = 0;
  let rescoreTimer = 0;
  let failOpenTimer = 0;
  let ui = null;
  let lastHiddenKey = '';
  let lastWorthKey = '';
  const tiles = new Map();

  // ---------------------------------------------------------------------------
  // Start-up and navigation
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.id = 'ww-youtube-css';
  style.textContent = feedHidingCss();
  document.documentElement.appendChild(style);

  Promise.all([loadSettings(), loadLocal()]).then(
    safe(([stored, local]) => {
      settings = stored;
      told = new Set(local.notInterested);
      worthOpen = local.worthOpen;
      setOverrides(local.corrections);
      updateRootClass();
      onNavigate();
    }),
  );
  document.addEventListener('yt-navigate-finish', safe(onNavigate));
  chrome.storage.onChanged.addListener(safe(onStorageChanged));

  function isActive() {
    return wwIsActive(settings) && !failedOpen;
  }

  function onHome() {
    return location.pathname === '/';
  }

  function updateRootClass() {
    document.documentElement.classList.toggle('ww-on', isActive());
    document.documentElement.classList.toggle('ww-no-shorts', isActive() && settings.hideShortsShelf);
  }

  // "Hide channel": hidden outright, no model involved.
  function channelHidden(id) {
    const channel = (known.get(id)?.channel || '').toLowerCase();
    return channel !== '' && settings.hiddenChannels.some((c) => c.toLowerCase() === channel);
  }

  function onNavigate() {
    if (!isActive() || !onHome()) {
      stopObserving();
      stopTelling = true;
      return;
    }
    for (const id of failed) queue.add(id); // retry anything that failed last time
    failed.clear();
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
    clearInterval(revealTimer);
    revealTimer = setInterval(safe(revealLate), 200);
    armFailOpen();
    scan();
  }

  function stopObserving() {
    if (observer) observer.disconnect();
    observer = null;
    observedEl = null;
    clearInterval(revealTimer);
    clearTimeout(failOpenTimer);
  }

  // ---------------------------------------------------------------------------
  // Reading and marking YouTube's cards
  // ---------------------------------------------------------------------------

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(
      safe(() => {
        scanTimer = 0;
        scan();
      }),
      SCAN_DELAY_MS,
    );
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

    const now = Date.now();
    const order = [];
    const seen = new Set();
    for (const card of itemsEl.querySelectorAll(`:scope > ${SELECTORS.gridCard}`)) {
      const item = readCard(card);
      const id = item?.videoId;
      // After "Not interested", YouTube swaps the card for its own "Video
      // removed" notice. The video was hidden, so keep the notice hidden too.
      if (!item && told.has(idOnCard.get(card))) {
        mark(card, 'hide');
        continue;
      }
      // YouTube reuses card elements: if this one now holds a different
      // video, forget how it was marked and start again.
      if (idOnCard.has(card) && idOnCard.get(card) !== id) {
        card.removeAttribute('data-ww');
        firstSeen.delete(card);
      }
      if (!firstSeen.has(card)) firstSeen.set(card, now);
      if (!item) {
        mark(card, 'show'); // ads, mixes, playlists: not ours to judge
        continue;
      }
      if (!item.title) continue; // still being filled in (revealLate covers it)
      idOnCard.set(card, id);
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      known.set(id, item);
      cardFor.set(id, card);
      addActions(card, id);
      apply(id);
      if (!verdicts.has(id) && !failed.has(id) && !inFlight.has(id) && !overrides.has(id) && !channelHidden(id)) queue.add(id);
    }
    feedOrder = order;
    if (order.length) clearTimeout(failOpenTimer);
    render();
    sendNext();
  }

  // Marks a card from the current verdict. `force`: the user asked for this
  // (a correction or a settings change), so an on-screen card may be hidden.
  function apply(id, force = false) {
    const card = cardFor.get(id);
    if (!card || !card.isConnected) return;
    const verdict = overrides.get(id) || (channelHidden(id) ? 'hide' : null) || verdicts.get(id) || (failed.has(id) ? 'show' : null);
    if (!verdict) return; // not scored yet: stays invisible until revealLate
    if (verdict === 'show') {
      leftInPlace.delete(id);
      mark(card, 'show');
      wwTally('shown', id);
      return;
    }
    // Bait. If it's already showing and could be in view (on screen or above
    // it), hiding it would move things under the user's eyes: leave it.
    if (!force && card.getAttribute('data-ww') === 'show' && card.getBoundingClientRect().top < innerHeight) {
      leftInPlace.add(id);
      wwTally('shown', id);
      return;
    }
    leftInPlace.delete(id);
    mark(card, 'hide');
    wwTally('hidden', id);
  }

  function mark(card, state) {
    if (card.getAttribute('data-ww') !== state) card.setAttribute('data-ww', state);
  }

  // Cards unscored after REVEAL_AFTER_MS are shown anyway.
  function revealLate() {
    if (!observedEl) return;
    const now = Date.now();
    let changed = false;
    for (const card of observedEl.querySelectorAll(`:scope > ${SELECTORS.gridCard}:not([data-ww])`)) {
      if (!firstSeen.has(card)) firstSeen.set(card, now);
      if (now - firstSeen.get(card) >= REVEAL_AFTER_MS) {
        mark(card, 'show');
        changed = true;
      }
    }
    if (changed) render();
  }

  // If YouTube shows cards but none can be read (selectors out of date),
  // switch the filter off for this page rather than risk hiding anything.
  function armFailOpen() {
    clearTimeout(failOpenTimer);
    failOpenTimer = setTimeout(
      safe(() => {
        const youtubeHasCards = observedEl && observedEl.querySelector(SELECTORS.gridCard);
        if (feedOrder.length === 0 && youtubeHasCards) {
          console.warn('Worthwhile: could not read any video cards, so leaving YouTube\'s feed alone. selectors.js may need updating.');
          failOpen();
        }
      }),
      FAIL_OPEN_MS,
    );
  }

  function failOpen() {
    failedOpen = true;
    stopObserving();
    updateRootClass();
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  // Up to MAX_PARALLEL requests at once, so every card on a first screen gets
  // its verdict at about the same time (one after another, the last batch
  // came back well after the 1.5 s reveal).
  function sendNext() {
    if (sending >= MAX_PARALLEL || !isActive()) return;
    if (queue.size === 0) {
      if (sending === 0) maybeSource();
      return;
    }
    sendBatch().catch(onUnexpectedError);
    sendNext(); // fill the remaining parallel slots
  }

  async function sendBatch() {
    sending++;

    // Cards on screen (still invisible, waiting) go first, in a small batch.
    const onScreen = (id) => {
      const top = cardFor.get(id)?.getBoundingClientRect().top ?? Infinity;
      return top < innerHeight;
    };
    const waiting = [...queue];
    const visible = waiting.filter(onScreen);
    const ids = visible.length ? visible.slice(0, FIRST_BATCH) : waiting.slice(0, BATCH_MAX);
    ids.forEach((id) => {
      queue.delete(id);
      inFlight.add(id);
    });
    const gen = generation;
    const reply = await wwScore(ids.map((id) => {
      const { title, channel, duration } = known.get(id);
      return { id, title, channel, duration };
    }));
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
          verdicts.delete(id); // any scoring error means "show"
          failed.add(id); // retried on the next visit or settings change
        }
        apply(id, gen === forceGeneration);
      }
      errorText = results ? '' : describeError(reply && reply.error);
    }

    sending--;
    render();
    sendNext();
  }

  function describeError(code) {
    if (code === 'no-token') return 'Add your invite token in Worthwhile settings.';
    if (code === 'bad-token') return 'Your invite token wasn\'t accepted. Check it in Worthwhile settings.';
    if (code === 'extension-reloaded') return 'Worthwhile was updated. Reload this page.';
    return 'Offline: showing everything. Worthwhile can\'t reach its server.';
  }

  function onStorageChanged(changes, area) {
    if (area === 'local') {
      if (changes.notInterested) told = new Set(changes.notInterested.newValue || []);
      if (changes.corrections) {
        setOverrides(changes.corrections.newValue || []);
        for (const id of overrides.keys()) apply(id, true); // only the corrected videos move
        scheduleRescore(false); // corrections are examples in the prompt: new scores
      }
      render();
      return;
    }
    if (area !== 'sync') return;
    const hiddenBefore = new Set(feedOrder.filter(channelHidden));
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    updateRootClass();
    if (changes.hiddenChannels) {
      // Only the affected channels' cards move, straight away (the user asked).
      for (const id of feedOrder) {
        if (channelHidden(id) === hiddenBefore.has(id)) continue;
        apply(id, true);
        if (!channelHidden(id) && !verdicts.has(id) && !overrides.has(id)) queue.add(id); // un-hidden: needs a score now
      }
      render();
      sendNext();
    }
    if ('enabled' in changes) onNavigate();
    if (['token', 'rubric', 'interests', 'rule', 'strictness'].some((key) => key in changes)) scheduleRescore(true);
  }

  function setOverrides(corrections) {
    overrides.clear();
    for (const c of corrections) if (c.videoId) overrides.set(c.videoId, c.verdict);
  }

  // Score every card again. `force`: the user changed a setting, so the new
  // verdicts apply to on-screen cards too. After a correction (not forced),
  // on-screen cards are left alone.
  function scheduleRescore(force) {
    generation++;
    errorText = '';
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(
      safe(() => {
        generation++; // ignore replies to requests sent before the edit finished
        if (force) forceGeneration = generation;
        for (const id of feedOrder) if (!overrides.has(id) && !channelHidden(id)) queue.add(id);
        failed.clear();
        sourcedGeneration = -1; // new settings: new sourced videos too
        if (isActive() && onHome()) onNavigate();
        render();
        sendNext();
      }),
      RESCORE_DELAY_MS,
    );
  }

  // ---------------------------------------------------------------------------
  // Corrections
  // ---------------------------------------------------------------------------

  // On hover over a visible card:
  //   "Wrong call"    hide it, and remember "should've hidden" (a correction)
  //   "Hide channel"  hide every video from this channel, no model involved
  //                   (undo from the list on the options page)
  function addActions(card, id) {
    let actions = card.querySelector(':scope > .ww-actions');
    if (!actions) {
      actions = wwEl('div', { className: 'ww-actions' });
      const wrong = wwEl('button', { className: 'ww-wrong', text: 'Wrong call' });
      wrong.title = 'Worthwhile: this is bait. Hide it and learn from it.';
      const channel = wwEl('button', { className: 'ww-hide-channel', text: 'Hide channel' });
      for (const button of [wrong, channel]) {
        button.type = 'button';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      }
      wrong.addEventListener('click', safe(() => correct(actions.dataset.videoId, 'hide')));
      channel.addEventListener(
        'click',
        safe(() => {
          const name = known.get(actions.dataset.videoId)?.channel;
          if (name) setChannelHidden(name, true).catch(onUnexpectedError);
        }),
      );
      actions.append(wrong, channel);
      card.appendChild(actions);
    }
    actions.dataset.videoId = id;
    const name = known.get(id)?.channel || '';
    const channelButton = actions.querySelector('.ww-hide-channel');
    channelButton.hidden = !name; // no channel name on the card: nothing to hide by
    channelButton.title = `Worthwhile: hide every video from ${name}. Undo in settings.`;
  }

  // "Show it anyway" (verdict 'show') or "Wrong call" (verdict 'hide').
  function correct(id, verdict) {
    const item = known.get(id);
    if (!item) return;
    overrides.set(id, verdict);
    wwTally('corrections', id);
    apply(id, true);
    render();
    rememberCorrection({ videoId: id, title: item.title, channel: item.channel, scores: scoresOf.get(id) || null, verdict }).catch(onUnexpectedError);
  }

  // ---------------------------------------------------------------------------
  // Sourcing: "Worth your time"
  // ---------------------------------------------------------------------------

  function maybeSource() {
    if (sourcing || !isActive() || !onHome() || feedOrder.length === 0) return;
    if (sourcedGeneration === generation && Date.now() - sourcedAt < RESOURCE_AFTER_MS) return;
    sourcing = true;
    const gen = generation;
    wwSource()
      .then(
        safe((reply) => {
          if (gen !== generation) return;
          if (Array.isArray(reply?.items)) sourced = reply.items;
          sourcedAt = Date.now();
          sourcedGeneration = gen;
        }),
      )
      .finally(() => {
        sourcing = false;
        render();
      });
  }

  // ---------------------------------------------------------------------------
  // Our bar above the grid
  // ---------------------------------------------------------------------------

  function ensureUi(itemsEl) {
    if (!ui) ui = buildUi();
    if (ui.root.nextElementSibling !== itemsEl) itemsEl.parentElement.insertBefore(ui.root, itemsEl);
  }

  function buildUi() {
    const root = wwEl('div', { id: 'ww-feed' });

    const bar = wwEl('div', { className: 'ww-bar' });
    const status = wwEl('span', { className: 'ww-status' });
    const toggle = wwEl('button', { className: 'ww-drawer-toggle' });
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      drawerOpen = !drawerOpen;
      render();
    });
    bar.append(wwEl('span', { className: 'ww-brand', text: 'Worthwhile' }), status, toggle);

    const notice = wwEl('div', { className: 'ww-notice' });

    // The Hidden drawer
    const drawer = wwEl('div', { className: 'ww-drawer' });
    const tell = wwEl('button', { className: 'ww-tell' });
    tell.type = 'button';
    tell.addEventListener('click', safe(onTellClicked));
    const tellNote = wwEl('span', { className: 'ww-tell-status' });
    const tellRow = wwEl('div', { className: 'ww-tell-row' });
    tellRow.append(tell, tellNote);
    // Testers should know this before they click it.
    const tellWarning = wwEl('div', { className: 'ww-tell-warning', text: 'This acts on your YouTube account.' });
    const list = wwEl('ol', { className: 'ww-hidden-list' });
    const lateNote = wwEl('div', { className: 'ww-late' });
    drawer.append(tellRow, tellWarning, list, lateNote);

    // "Worth your time"
    const worth = wwEl('details', { className: 'ww-worth' });
    worth.open = worthOpen;
    worth.append(wwEl('summary', { text: 'Worth your time' }));
    const worthGrid = wwEl('div', { className: 'ww-worth-grid' });
    worth.append(worthGrid);
    worth.addEventListener('toggle', () => {
      worthOpen = worth.open;
      chrome.storage.local.set({ worthOpen }).catch(() => {});
    });

    root.append(bar, notice, drawer, worth);
    return { root, status, toggle, notice, drawer, tell, tellNote, list, lateNote, worth, worthGrid };
  }

  function render() {
    if (!ui) return;
    const hidden = feedOrder.filter((id) => cardFor.get(id)?.getAttribute('data-ww') === 'hide');
    const pending = feedOrder.filter((id) => !verdicts.has(id) && !failed.has(id) && !overrides.has(id) && !channelHidden(id)).length;

    const parts = [`${hidden.length} hidden`];
    if (pending || sending) parts.push('scoring…');
    ui.status.textContent = parts.join(' · ');
    ui.root.classList.toggle('ww-busy', pending > 0 || sending);
    ui.toggle.textContent = drawerOpen ? 'Hide list' : `Hidden (${hidden.length})`;
    ui.toggle.setAttribute('aria-expanded', String(drawerOpen));
    ui.toggle.hidden = hidden.length === 0 && leftInPlace.size === 0 && !drawerOpen;

    ui.notice.textContent = errorText;
    ui.notice.hidden = !errorText;

    ui.drawer.hidden = !drawerOpen;
    if (drawerOpen) renderDrawer(hidden);
    renderWorth();
  }

  function renderDrawer(hidden) {
    const waiting = hidden.filter((id) => !told.has(id) && !tellFailed.has(id)).length;
    ui.tell.textContent = telling ? 'Stop' : 'Tell YouTube: not interested';
    ui.tell.disabled = !telling && waiting === 0;
    ui.tell.title = telling ? '' : `Marks up to ${TELL_PER_CLICK} of these with YouTube's own "Not interested", one at a time.`;
    ui.tellNote.textContent = tellStatus;

    const key = hidden.map((id) => `${id}:${told.has(id) ? 1 : 0}:${tellFailed.get(id) || ''}`).join(',');
    if (key !== lastHiddenKey) {
      lastHiddenKey = key;
      ui.list.replaceChildren(
        ...hidden.map((id) => {
          const { title, channel } = known.get(id);
          const row = wwEl('li');
          const link = wwEl('a', { text: title });
          link.href = `/watch?v=${id}`;
          const s = scoresOf.get(id);
          const why = overrides.get(id) === 'hide' ? 'you marked it' : channelHidden(id) ? 'channel hidden' : s ?`bait ${s.bait} · interest ${s.interest_match} · substance ${s.substance}` : '';
          row.append(link, wwEl('span', { className: 'ww-hidden-meta', text: [channel, why].filter(Boolean).join(' · ') }));
          const show = wwEl('button', { className: 'ww-show-anyway', text: 'Show it anyway' });
          show.type = 'button';
          show.addEventListener('click', safe(() => correct(id, 'show')));
          row.append(show);
          if (told.has(id)) row.append(wwEl('span', { className: 'ww-told', text: '✓ told YouTube' }));
          else if (tellFailed.has(id)) row.append(wwEl('span', { className: 'ww-told ww-told-failed', text: 'couldn\'t mark' }));
          return row;
        }),
      );
    }
    const late = [...leftInPlace].filter((id) => feedOrder.includes(id));
    ui.lateNote.textContent = late.length
      ? `${late.length} more scored as bait after it was already on screen, so it was left in place: ${late.map((id) => known.get(id).title).join('; ')}`
      : '';
    ui.lateNote.hidden = late.length === 0;
  }

  function renderWorth() {
    const inFeed = new Set(feedOrder);
    const picks = sourced.filter((s) => !inFeed.has(s.id) && !told.has(s.id)).slice(0, WORTH_MAX);
    ui.worth.hidden = picks.length === 0;
    const key = picks.map((s) => s.id).join(',');
    if (key === lastWorthKey) return;
    lastWorthKey = key;
    ui.worthGrid.replaceChildren(...picks.map(worthTile));
  }

  // Laid out like YouTube's own card: thumbnail, two-line title, channel,
  // then "views • age". A normal link (these aren't in YouTube's feed).
  function worthTile(item) {
    if (tiles.has(item.id)) return tiles.get(item.id);
    const tile = wwEl('a', { className: 'ww-tile' });
    tile.href = `/watch?v=${item.id}`;
    const from = item.source.startsWith('interest:') ? `your interest "${item.source.slice(9)}"` : 'a channel you\'ve opened';
    tile.title = `${item.title}\nFound by Worthwhile from ${from}`;
    const thumb = wwEl('div', { className: 'ww-thumb' });
    const img = wwEl('img');
    img.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
    if (item.duration) thumb.append(wwEl('span', { className: 'ww-duration', text: item.duration }));
    const meta = [wwViews(item.views), wwAgo(item.publishedAt)].filter(Boolean).join(' • ');
    tile.append(
      thumb,
      wwEl('div', { className: 'ww-title', text: item.title }),
      wwEl('div', { className: 'ww-channel', text: item.channel }),
      wwEl('div', { className: 'ww-meta', text: meta }),
    );
    // Record the channel first (we know its ID) so the page change can't cut it off.
    tile.addEventListener('click', (event) => {
      const remembered = rememberChannel({ id: item.channelId, name: item.channel });
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      remembered.finally(() => location.assign(tile.href));
    });
    tiles.set(item.id, tile);
    return tile;
  }

  // ---------------------------------------------------------------------------
  // "Tell YouTube: not interested"
  // ---------------------------------------------------------------------------

  // One click: up to 10 hidden videos, one at a time, a person-like 1-3 s
  // apart. Clicking again while it runs stops it. Never runs by itself.
  async function onTellClicked() {
    if (telling) {
      stopTelling = true;
      return;
    }
    const targets = feedOrder
      .filter((id) => cardFor.get(id)?.getAttribute('data-ww') === 'hide' && !told.has(id) && !tellFailed.has(id))
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

      const card = cardFor.get(id);
      // Counted as told before the click: YouTube swaps the card for its
      // "Video removed" notice during the click, and scan() keeps notices of
      // told videos hidden. Undone if the click fails.
      told.add(id);
      const result = card && card.isConnected ? await wwTellNotInterested(card) : 'gone';
      if (result === 'ok') {
        done++;
        missingOption = 0;
        await rememberNotInterested(id);
      } else {
        told.delete(id);
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

  // Wraps a callback so an unexpected error switches the filter off (showing
  // YouTube's feed as normal) instead of leaving cards hidden.
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
    console.error('Worthwhile hit an error and switched itself off for this page:', err);
    failOpen();
  }
})();
