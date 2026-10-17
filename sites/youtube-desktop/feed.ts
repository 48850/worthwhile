// sites/youtube-desktop/feed.ts
//
// The home page. Runs on every youtube.com page; YouTube is a single-page
// app, so this one script lives across in-app navigation (yt-navigate-finish).
// (watch.ts handles the /watch sidebar, shorts.ts handles /shorts.)
// Ported unchanged from extension/content.js.
//
// Worthwhile SUBTRACTS from YouTube's own home grid; it never replaces it.
// While the filter is on:
//   1. Each card stays invisible (keeping its slot) until it's scored, so
//      bait never flashes. After 1.5 s it's shown anyway, scored or not.
//   2. Bait is removed from the grid; everything else stays exactly where
//      YouTube put it (the CSS in selectors.ts keeps the columns aligned).
//   3. A verdict that arrives after a card is already showing only removes
//      it if it's below the screen, so nothing vanishes under your eyes.
//      Otherwise it's "left in place" and listed in the drawer.
//   4. A small bar above the grid holds the "Hidden (N)" drawer (with "Show
//      it anyway" and "Tell YouTube: not interested") and a collapsible
//      "Worth your time" row of up to 6 sourced videos.
//   5. Hovering a visible card shows "Wrong call", which hides it.
// Both corrections are remembered on this device and sent with future
// scoring as labelled examples (see core/settings.ts).
// Each card's decision (core/decide.ts) is also emitted as an event.
//
// Failure rule: never worse than plain YouTube. Unscored means shown; a
// scoring error means shown; if no card can be read, or the script hits an
// error, the filter switches itself off for the page.

import { tally } from '../../core/counts';
import { decide } from '../../core/decide';
import { DEFAULT_SETTINGS, type Correction, type LocalData, type Settings } from '../../core/settings';
import type { Scores, Verdict } from '../../core/types';
import { formatAgo, formatViews, sleep, waitFor } from '../../core/util';
import type { StorageChanges } from '../../core/interfaces';
import { desktopHome, type DesktopItem } from './adapter';
import { el } from './dom';
import type { PageEnv } from './env';
import { tellNotInterested, type TellResult } from './notinterested';
import { feedHidingCss, SELECTORS } from './selectors';

const FIRST_BATCH = 10; // the cards on screen first, in a small batch, for speed
const BATCH_MAX = 40; // after that, up to this many per request (the Worker accepts 60)
const MAX_PARALLEL = 3; // requests at once
const SCAN_DELAY_MS = 50; // cards stay invisible while waiting, so read them quickly
const REVEAL_AFTER_MS = 1500; // show a card after this long even if it isn't scored yet
const RESCORE_DELAY_MS = 1200; // let the user finish editing settings before re-scoring
const FAIL_OPEN_MS = 10000; // no readable card this long after cards appear: switch off
const WORTH_MAX = 6; // "Worth your time" row
const RESOURCE_AFTER_MS = 10 * 60 * 1000; // ask for sourced videos again after 10 minutes
const TELL_PER_CLICK = 10; // "Not interested": at most this many per click
const TELL_PAUSE_MS = [1000, 3000]; // random pause between each, like a person

/** A video found by sourcing (the Worker's /source reply). */
interface SourcedItem {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  duration: string;
  views: number | null;
  publishedAt: string | null;
  source: string;
}

export function startHomeFeed(env: PageEnv): void {
  const { stores } = env;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let failedOpen = false;

  const known = new Map<string, DesktopItem>(); // videoId -> the card's item
  const cardFor = new Map<string, Element>(); // videoId -> YouTube's card element
  const idOnCard = new WeakMap<Element, string>(); // card element -> videoId it was marked for (YouTube reuses cards)
  const firstSeen = new WeakMap<Element, number>(); // card element -> when it first appeared
  const verdicts = new Map<string, Verdict>(); // videoId -> 'show' | 'hide', from scoring
  const scoresOf = new Map<string, Scores>(); // videoId -> { interest_match, substance, bait }
  const overrides = new Map<string, Verdict>(); // videoId -> 'show' | 'hide', from the user's corrections
  const failed = new Set<string>(); // videoIds whose scoring failed (shown; retried later)
  const leftInPlace = new Set<string>(); // bait scored after it was already on screen
  const queue = new Set<string>();
  const inFlight = new Set<string>();
  let feedOrder: string[] = []; // videoIds currently in YouTube's grid, in order

  let sourced: SourcedItem[] = [];
  let sourcing = false;
  let sourcedAt = 0;
  let sourcedGeneration = -1;
  let worthOpen = true;

  let told = new Set<string>(); // videoIds already marked "Not interested"
  const tellFailed = new Map<string, TellResult | 'gone'>();
  let telling = false;
  let stopTelling = false;
  let tellStatus = '';

  let generation = 0; // bumped when settings change; replies for old settings are ignored
  let forceGeneration = -1; // replies for this generation may hide on-screen cards (the user changed settings)
  let sending = 0; // requests in flight
  let errorText = '';
  let drawerOpen = false;

  let stopObserver: (() => void) | null = null;
  let observedEl: Element | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let revealTimer: ReturnType<typeof setInterval> | 0 = 0;
  let rescoreTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let failOpenTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let ui: Ui | null = null;
  let lastHiddenKey = '';
  let lastWorthKey = '';
  const tiles = new Map<string, HTMLAnchorElement>();

  // ---------------------------------------------------------------------------
  // Start-up and navigation
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.id = 'ww-youtube-css';
  style.textContent = feedHidingCss();
  document.documentElement.appendChild(style);

  Promise.all([stores.loadSettings(), stores.loadLocal()]).then(
    safe(([stored, local]: [Settings, LocalData]) => {
      settings = stored;
      told = new Set(local.notInterested);
      worthOpen = local.worthOpen;
      setOverrides(local.corrections);
      updateRootClass();
      onNavigate();
    }),
  );
  document.addEventListener('yt-navigate-finish', safe(onNavigate));
  stores.localStore.onChanged?.(safe((changes: StorageChanges) => onStorageChanged(changes, 'local')));
  stores.settingsStore.onChanged?.(safe((changes: StorageChanges) => onStorageChanged(changes, 'sync')));

  function isActive(): boolean {
    return settings.enabled && Boolean(settings.token) && !failedOpen;
  }

  function onHome(): boolean {
    return location.pathname === '/';
  }

  function updateRootClass(): void {
    document.documentElement.classList.toggle('ww-on', isActive());
    document.documentElement.classList.toggle('ww-no-shorts', isActive() && settings.hideShortsShelf);
  }

  // "Hide channel": hidden outright, no model involved.
  function channelHidden(id: string): boolean {
    const channel = (known.get(id)?.channel || '').toLowerCase();
    return channel !== '' && settings.hiddenChannels.some((c) => c.toLowerCase() === channel);
  }

  function onNavigate(): void {
    if (!isActive() || !onHome()) {
      stopObserving();
      stopTelling = true;
      return;
    }
    for (const id of failed) queue.add(id); // retry anything that failed last time
    failed.clear();
    waitFor(() => document.querySelector(`${SELECTORS.homeFeed} ${SELECTORS.gridItems}`), 15000).then(
      safe((itemsEl: Element | null) => {
        if (itemsEl && isActive() && onHome()) startObserving(itemsEl);
      }),
    );
  }

  function startObserving(itemsEl: Element): void {
    stopObserver?.();
    observedEl = itemsEl;
    stopObserver = desktopHome.observe(itemsEl, safe(scheduleScan));
    clearInterval(revealTimer);
    revealTimer = setInterval(safe(revealLate), 200);
    armFailOpen();
    scan();
  }

  function stopObserving(): void {
    stopObserver?.();
    stopObserver = null;
    observedEl = null;
    clearInterval(revealTimer);
    clearTimeout(failOpenTimer);
  }

  // ---------------------------------------------------------------------------
  // Reading and marking YouTube's cards
  // ---------------------------------------------------------------------------

  function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(
      safe(() => {
        scanTimer = 0;
        scan();
      }),
      SCAN_DELAY_MS,
    );
  }

  function scan(): void {
    if (!isActive() || !onHome()) return;
    const itemsEl = document.querySelector(`${SELECTORS.homeFeed} ${SELECTORS.gridItems}`);
    if (!itemsEl) return;
    if (itemsEl !== observedEl) {
      startObserving(itemsEl); // YouTube replaced the grid (e.g. a topic chip was clicked)
      return;
    }
    ensureUi(itemsEl);

    const now = Date.now();
    const order: string[] = [];
    const seen = new Set<string>();
    for (const card of desktopHome.findItems(itemsEl)) {
      const item = desktopHome.readItem(card);
      const id = item?.id;
      // After "Not interested", YouTube swaps the card for its own "Video
      // removed" notice. The video was hidden, so keep the notice hidden too.
      if (!item && told.has(idOnCard.get(card)!)) {
        desktopHome.hideItem(card);
        continue;
      }
      // YouTube reuses card elements: if this one now holds a different
      // video, forget how it was marked and start again.
      if (idOnCard.has(card) && idOnCard.get(card) !== id) {
        card.removeAttribute('data-ww');
        card.removeAttribute('data-ww-hallmark');
        firstSeen.delete(card);
      }
      if (!firstSeen.has(card)) firstSeen.set(card, now);
      if (!item) {
        desktopHome.showItem(card); // ads, mixes, playlists: not ours to judge
        continue;
      }
      if (!item.title) continue; // still being filled in (revealLate covers it)
      idOnCard.set(card, id!);
      if (seen.has(id!)) continue;
      seen.add(id!);
      order.push(id!);
      known.set(id!, item);
      cardFor.set(id!, card);
      addActions(card, id!);
      apply(id!);
      if (!verdicts.has(id!) && !failed.has(id!) && !inFlight.has(id!) && !overrides.has(id!) && !channelHidden(id!)) queue.add(id!);
    }
    feedOrder = order;
    if (order.length) clearTimeout(failOpenTimer);
    render();
    sendNext();
  }

  // Marks a card from the current decision. `force`: the user asked for this
  // (a correction or a settings change), so an on-screen card may be hidden.
  function apply(id: string, force = false): void {
    const card = cardFor.get(id);
    if (!card || !card.isConnected) return;
    const item = known.get(id)!;
    const decision = decide({
      item,
      override: overrides.get(id),
      channelHidden: channelHidden(id),
      classification: verdicts.has(id) ? { verdict: verdicts.get(id)!, scores: scoresOf.get(id) || null } : null,
      failed: failed.has(id),
      taste: env.taste(),
    });
    if (!decision) return; // not scored yet: stays invisible until revealLate
    if (decision.action !== 'hide') {
      leftInPlace.delete(id);
      if (decision.action === 'hallmark') desktopHome.markHallmarked(card);
      else desktopHome.showItem(card);
      tally('shown', id);
      env.events.itemDecided(id, false, decision);
      return;
    }
    // Bait. If it's already showing and could be in view (on screen or above
    // it), hiding it would move things under the user's eyes: leave it.
    if (!force && card.getAttribute('data-ww') === 'show' && card.getBoundingClientRect().top < innerHeight) {
      leftInPlace.add(id);
      tally('shown', id);
      env.events.itemDecided(id, false, { action: 'show', reason: decision.reason });
      return;
    }
    leftInPlace.delete(id);
    desktopHome.hideItem(card);
    tally('hidden', id);
    env.events.itemDecided(id, false, decision);
  }

  // Cards unscored after REVEAL_AFTER_MS are shown anyway.
  function revealLate(): void {
    if (!observedEl) return;
    const now = Date.now();
    let changed = false;
    for (const card of observedEl.querySelectorAll(`:scope > ${SELECTORS.gridCard}:not([data-ww])`)) {
      if (!firstSeen.has(card)) firstSeen.set(card, now);
      if (now - firstSeen.get(card)! >= REVEAL_AFTER_MS) {
        desktopHome.showItem(card);
        const id = idOnCard.get(card);
        if (id) env.events.itemDecided(id, false, { action: 'show', reason: 'unscored' });
        changed = true;
      }
    }
    if (changed) render();
  }

  // If YouTube shows cards but none can be read (selectors out of date),
  // switch the filter off for this page rather than risk hiding anything.
  function armFailOpen(): void {
    clearTimeout(failOpenTimer);
    failOpenTimer = setTimeout(
      safe(() => {
        const youtubeHasCards = observedEl && observedEl.querySelector(SELECTORS.gridCard);
        if (feedOrder.length === 0 && youtubeHasCards) {
          console.warn("Worthwhile: could not read any video cards, so leaving YouTube's feed alone. selectors.ts may need updating.");
          failOpen();
        }
      }),
      FAIL_OPEN_MS,
    );
  }

  function failOpen(): void {
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
  function sendNext(): void {
    if (sending >= MAX_PARALLEL || !isActive()) return;
    if (queue.size === 0) {
      if (sending === 0) maybeSource();
      return;
    }
    sendBatch().catch(onUnexpectedError);
    sendNext(); // fill the remaining parallel slots
  }

  async function sendBatch(): Promise<void> {
    sending++;

    // Cards on screen (still invisible, waiting) go first, in a small batch.
    const onScreen = (id: string) => {
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
    const result = await env.classifier.classify(ids.map((id) => known.get(id)!));
    ids.forEach((id) => inFlight.delete(id));

    if (gen === generation) {
      for (const id of ids) {
        const classification = result.decisions?.[id];
        if (classification) {
          verdicts.set(id, classification.verdict);
          if (classification.scores) scoresOf.set(id, classification.scores);
          failed.delete(id);
        } else {
          verdicts.delete(id); // any scoring error means "show"
          failed.add(id); // retried on the next visit or settings change
        }
        apply(id, gen === forceGeneration);
      }
      errorText = result.decisions ? '' : describeError(result.error);
    }

    sending--;
    render();
    sendNext();
  }

  function describeError(code: string | undefined): string {
    if (code === 'no-token') return 'Add your invite token in Worthwhile settings.';
    if (code === 'bad-token') return "Your invite token wasn't accepted. Check it in Worthwhile settings.";
    if (code === 'extension-reloaded') return 'Worthwhile was updated. Reload this page.';
    return "Offline: showing everything. Worthwhile can't reach its server.";
  }

  function onStorageChanged(changes: StorageChanges, area: 'local' | 'sync'): void {
    if (area === 'local') {
      if (changes.notInterested) told = new Set((changes.notInterested.newValue as string[]) || []);
      if (changes.corrections) {
        setOverrides((changes.corrections.newValue as Correction[]) || []);
        for (const id of overrides.keys()) apply(id, true); // only the corrected videos move
        scheduleRescore(false); // corrections are examples in the prompt: new scores
      }
      render();
      return;
    }
    const hiddenBefore = new Set(feedOrder.filter(channelHidden));
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        (settings as any)[key] = change.newValue === undefined ? (DEFAULT_SETTINGS as any)[key] : change.newValue;
      }
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

  function setOverrides(corrections: Correction[]): void {
    overrides.clear();
    for (const c of corrections) if (c.videoId) overrides.set(c.videoId, c.verdict);
  }

  // Score every card again. `force`: the user changed a setting, so the new
  // verdicts apply to on-screen cards too. After a correction (not forced),
  // on-screen cards are left alone.
  function scheduleRescore(force: boolean): void {
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
  function addActions(card: Element, id: string): void {
    let actions = card.querySelector<HTMLElement>(':scope > .ww-actions');
    if (!actions) {
      const created = el('div', { className: 'ww-actions' });
      const wrong = el('button', { className: 'ww-wrong', text: 'Wrong call' });
      wrong.title = 'Worthwhile: this is bait. Hide it and learn from it.';
      const channel = el('button', { className: 'ww-hide-channel', text: 'Hide channel' });
      for (const button of [wrong, channel]) {
        button.type = 'button';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      }
      wrong.addEventListener('click', safe(() => correct(created.dataset.videoId!, 'hide')));
      channel.addEventListener(
        'click',
        safe(() => {
          const name = known.get(created.dataset.videoId!)?.channel;
          if (name) stores.setChannelHidden(name, true).catch(onUnexpectedError);
        }),
      );
      created.append(wrong, channel);
      card.appendChild(created);
      actions = created;
    }
    actions.dataset.videoId = id;
    const name = known.get(id)?.channel || '';
    const channelButton = actions.querySelector<HTMLButtonElement>('.ww-hide-channel')!;
    channelButton.hidden = !name; // no channel name on the card: nothing to hide by
    channelButton.title = `Worthwhile: hide every video from ${name}. Undo in settings.`;
  }

  // "Show it anyway" (verdict 'show') or "Wrong call" (verdict 'hide').
  function correct(id: string, verdict: Verdict): void {
    const item = known.get(id);
    if (!item) return;
    overrides.set(id, verdict);
    tally('corrections', id);
    apply(id, true);
    render();
    stores
      .rememberCorrection({ videoId: id, title: item.title, channel: item.channel, scores: scoresOf.get(id) || null, verdict })
      .catch(onUnexpectedError);
  }

  // ---------------------------------------------------------------------------
  // Sourcing: "Worth your time"
  // ---------------------------------------------------------------------------

  function maybeSource(): void {
    if (sourcing || !isActive() || !onHome() || feedOrder.length === 0) return;
    if (sourcedGeneration === generation && Date.now() - sourcedAt < RESOURCE_AFTER_MS) return;
    sourcing = true;
    const gen = generation;
    env.messaging
      .send<{ items?: SourcedItem[] }>({ type: 'source' })
      .catch(() => ({ error: 'extension-reloaded' }) as { items?: SourcedItem[] })
      .then(
        safe((reply: { items?: SourcedItem[] }) => {
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

  interface Ui {
    root: HTMLElement;
    status: HTMLElement;
    toggle: HTMLButtonElement;
    notice: HTMLElement;
    drawer: HTMLElement;
    tell: HTMLButtonElement;
    tellNote: HTMLElement;
    list: HTMLElement;
    lateNote: HTMLElement;
    worth: HTMLDetailsElement;
    worthGrid: HTMLElement;
  }

  function ensureUi(itemsEl: Element): void {
    if (!ui) ui = buildUi();
    if (ui.root.nextElementSibling !== itemsEl) itemsEl.parentElement!.insertBefore(ui.root, itemsEl);
  }

  function buildUi(): Ui {
    const root = el('div', { id: 'ww-feed' });

    const bar = el('div', { className: 'ww-bar' });
    const status = el('span', { className: 'ww-status' });
    const toggle = el('button', { className: 'ww-drawer-toggle' });
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      drawerOpen = !drawerOpen;
      render();
    });
    bar.append(el('span', { className: 'ww-brand', text: 'Worthwhile' }), status, toggle);

    const notice = el('div', { className: 'ww-notice' });

    // The Hidden drawer
    const drawer = el('div', { className: 'ww-drawer' });
    const tell = el('button', { className: 'ww-tell' });
    tell.type = 'button';
    tell.addEventListener('click', safe(onTellClicked));
    const tellNote = el('span', { className: 'ww-tell-status' });
    const tellRow = el('div', { className: 'ww-tell-row' });
    tellRow.append(tell, tellNote);
    // Testers should know this before they click it.
    const tellWarning = el('div', { className: 'ww-tell-warning', text: 'This acts on your YouTube account.' });
    const list = el('ol', { className: 'ww-hidden-list' });
    const lateNote = el('div', { className: 'ww-late' });
    drawer.append(tellRow, tellWarning, list, lateNote);

    // "Worth your time"
    const worth = el('details', { className: 'ww-worth' });
    worth.open = worthOpen;
    worth.append(el('summary', { text: 'Worth your time' }));
    const worthGrid = el('div', { className: 'ww-worth-grid' });
    worth.append(worthGrid);
    worth.addEventListener('toggle', () => {
      worthOpen = worth.open;
      stores.localStore.set({ worthOpen }).catch(() => {});
    });

    root.append(bar, notice, drawer, worth);
    return { root, status, toggle, notice, drawer, tell, tellNote, list, lateNote, worth, worthGrid };
  }

  function render(): void {
    if (!ui) return;
    const hidden = feedOrder.filter((id) => cardFor.get(id)?.getAttribute('data-ww') === 'hide');
    const pending = feedOrder.filter((id) => !verdicts.has(id) && !failed.has(id) && !overrides.has(id) && !channelHidden(id)).length;

    const parts = [`${hidden.length} hidden`];
    if (pending || sending) parts.push('scoring…');
    ui.status.textContent = parts.join(' · ');
    ui.root.classList.toggle('ww-busy', pending > 0 || sending > 0);
    ui.toggle.textContent = drawerOpen ? 'Hide list' : `Hidden (${hidden.length})`;
    ui.toggle.setAttribute('aria-expanded', String(drawerOpen));
    ui.toggle.hidden = hidden.length === 0 && leftInPlace.size === 0 && !drawerOpen;

    ui.notice.textContent = errorText;
    ui.notice.hidden = !errorText;

    ui.drawer.hidden = !drawerOpen;
    if (drawerOpen) renderDrawer(hidden);
    renderWorth();
  }

  function renderDrawer(hidden: string[]): void {
    const u = ui!;
    const waiting = hidden.filter((id) => !told.has(id) && !tellFailed.has(id)).length;
    u.tell.textContent = telling ? 'Stop' : 'Tell YouTube: not interested';
    u.tell.disabled = !telling && waiting === 0;
    u.tell.title = telling ? '' : `Marks up to ${TELL_PER_CLICK} of these with YouTube's own "Not interested", one at a time.`;
    u.tellNote.textContent = tellStatus;

    const key = hidden.map((id) => `${id}:${told.has(id) ? 1 : 0}:${tellFailed.get(id) || ''}`).join(',');
    if (key !== lastHiddenKey) {
      lastHiddenKey = key;
      u.list.replaceChildren(
        ...hidden.map((id) => {
          const { title, channel } = known.get(id)!;
          const row = el('li');
          const link = el('a', { text: title });
          link.href = `/watch?v=${id}`;
          const s = scoresOf.get(id);
          const why =
            overrides.get(id) === 'hide'
              ? 'you marked it'
              : channelHidden(id)
                ? 'channel hidden'
                : s
                  ? `bait ${s.bait} · interest ${s.interest_match} · substance ${s.substance}`
                  : '';
          row.append(link, el('span', { className: 'ww-hidden-meta', text: [channel, why].filter(Boolean).join(' · ') }));
          const show = el('button', { className: 'ww-show-anyway', text: 'Show it anyway' });
          show.type = 'button';
          show.addEventListener('click', safe(() => correct(id, 'show')));
          row.append(show);
          if (told.has(id)) row.append(el('span', { className: 'ww-told', text: '✓ told YouTube' }));
          else if (tellFailed.has(id)) row.append(el('span', { className: 'ww-told ww-told-failed', text: "couldn't mark" }));
          return row;
        }),
      );
    }
    const late = [...leftInPlace].filter((id) => feedOrder.includes(id));
    u.lateNote.textContent = late.length
      ? `${late.length} more scored as bait after it was already on screen, so it was left in place: ${late.map((id) => known.get(id)!.title).join('; ')}`
      : '';
    u.lateNote.hidden = late.length === 0;
  }

  function renderWorth(): void {
    const u = ui!;
    const inFeed = new Set(feedOrder);
    const picks = sourced.filter((s) => !inFeed.has(s.id) && !told.has(s.id)).slice(0, WORTH_MAX);
    u.worth.hidden = picks.length === 0;
    const key = picks.map((s) => s.id).join(',');
    if (key === lastWorthKey) return;
    lastWorthKey = key;
    u.worthGrid.replaceChildren(...picks.map(worthTile));
  }

  // Laid out like YouTube's own card: thumbnail, two-line title, channel,
  // then "views • age". A normal link (these aren't in YouTube's feed).
  function worthTile(item: SourcedItem): HTMLAnchorElement {
    if (tiles.has(item.id)) return tiles.get(item.id)!;
    const tile = el('a', { className: 'ww-tile' });
    tile.href = `/watch?v=${item.id}`;
    const from = item.source.startsWith('interest:') ? `your interest "${item.source.slice(9)}"` : "a channel you've opened";
    tile.title = `${item.title}\nFound by Worthwhile from ${from}`;
    const thumb = el('div', { className: 'ww-thumb' });
    const img = el('img');
    img.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
    if (item.duration) thumb.append(el('span', { className: 'ww-duration', text: item.duration }));
    const meta = [formatViews(item.views), formatAgo(item.publishedAt)].filter(Boolean).join(' • ');
    tile.append(
      thumb,
      el('div', { className: 'ww-title', text: item.title }),
      el('div', { className: 'ww-channel', text: item.channel }),
      el('div', { className: 'ww-meta', text: meta }),
    );
    // Record the channel first (we know its ID) so the page change can't cut it off.
    tile.addEventListener('click', (event) => {
      const remembered = stores.rememberChannel({ id: item.channelId, name: item.channel });
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
  async function onTellClicked(): Promise<void> {
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
      const result = card && card.isConnected ? await tellNotInterested(card) : 'gone';
      if (result === 'ok') {
        done++;
        missingOption = 0;
        await stores.rememberNotInterested(id);
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
        await sleep(min + Math.random() * (max - min));
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
  function safe<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A) => {
      try {
        const result = fn(...args);
        if (result && typeof (result as any).catch === 'function') (result as any).catch(onUnexpectedError);
        return result;
      } catch (err) {
        onUnexpectedError(err);
        return undefined;
      }
    };
  }

  function onUnexpectedError(err: unknown): void {
    console.error('Worthwhile hit an error and switched itself off for this page:', err);
    failOpen();
  }
}
