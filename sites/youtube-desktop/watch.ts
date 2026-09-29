// sites/youtube-desktop/watch.ts
//
// /watch pages, while the filter is on:
//   1. The recommendations sidebar is filtered in place: each card is dimmed
//      until scored, then hidden if it fails (CSS from selectors.ts, keyed on
//      data-ww-verdict). A vertical list has no gaps to fill, so unlike the
//      home page there is no grid of our own.
//   2. When the video was opened from our home grid, its channel is recorded
//      (on this device only) so sourcing can search that channel's uploads.
// Ported unchanged from extension/watch.js; each card's verdict is also
// emitted as an event.
//
// Failure rule: a scoring error means "show".

import { tally } from '../../core/counts';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import type { Verdict } from '../../core/types';
import { sleep, waitFor } from '../../core/util';
import type { PageEnv } from './env';
import { findCards, readCard, readWatchChannel, SELECTORS, type DesktopCard } from './selectors';

const BATCH_MAX = 40;
const SCAN_DELAY_MS = 300;

/**
 * Set when a feed tile is clicked, so this can record the channel once the
 * video's page has loaded. { videoId, channel, at }
 * (Nothing sets it since the home feed stopped drawing its own grid: see the
 * audit, bug 1. Kept as it was, not fixed silently.)
 */
export const opened: { pending: { videoId: string; channel: string; at: number } | null } = { pending: null };

export function startWatch(env: PageEnv): void {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const verdicts = new Map<string, Verdict>(); // videoId -> 'show' | 'hide' (this page session)
  const queue = new Map<string, DesktopCard>(); // videoId -> item waiting to be sent
  const inFlight = new Set<string>();
  let sending = false;
  let generation = 0;
  let observer: MutationObserver | null = null;
  let observedEl: Element | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  const isActive = () => settings.enabled && Boolean(settings.token);

  env.stores.loadSettings().then((stored) => {
    settings = stored;
    onNavigate();
  });
  document.addEventListener('yt-navigate-finish', onNavigate);
  env.stores.settingsStore.onChanged?.((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        (settings as any)[key] = change.newValue === undefined ? (DEFAULT_SETTINGS as any)[key] : change.newValue;
      }
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

  function onWatch(): boolean {
    return location.pathname === '/watch';
  }

  function onNavigate(): void {
    recordOpenedChannel().catch((err) => console.warn('Worthwhile: could not record the channel:', err));
    if (!isActive() || !onWatch()) {
      if (observer) observer.disconnect();
      observer = null;
      observedEl = null;
      return;
    }
    waitFor(() => document.querySelector(SELECTORS.sidebar), 15000).then((sidebar) => {
      if (sidebar && isActive() && onWatch()) observe(sidebar);
    });
  }

  function observe(sidebar: Element): void {
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
  function scan(): void {
    const sidebar = document.querySelector(SELECTORS.sidebar);
    if (!sidebar || !isActive() || !onWatch()) return;
    if (sidebar !== observedEl) return observe(sidebar);
    for (const card of findCards(sidebar)) {
      const item = readCard(card);
      if (!item || !item.title) continue; // mixes, playlists, ads, unfilled cards: left alone
      const channel = item.channel.toLowerCase();
      const channelHidden = channel !== '' && settings.hiddenChannels.some((c) => c.toLowerCase() === channel);
      const verdict = channelHidden ? 'hide' : verdicts.get(item.videoId) || 'pending';
      if (card.getAttribute('data-ww-verdict') !== verdict) card.setAttribute('data-ww-verdict', verdict);
      if (verdict !== 'pending') {
        tally(verdict === 'hide' ? 'hidden' : 'shown', item.videoId);
        env.events.itemDecided(item.videoId, false, { action: verdict, reason: channelHidden ? 'channel-hidden' : 'scored' });
      }
      if (verdict === 'pending' && !inFlight.has(item.videoId)) queue.set(item.videoId, item);
    }
    send();
  }

  async function send(): Promise<void> {
    if (sending || queue.size === 0) return;
    sending = true;
    const batch = [...queue.values()].slice(0, BATCH_MAX);
    batch.forEach((item) => {
      queue.delete(item.videoId);
      inFlight.add(item.videoId);
    });
    const gen = generation;
    const result = await env.classifier.classify(
      batch.map(({ videoId, title, channel, duration }) => ({ id: videoId, title, channel, duration, isShort: false, url: '' })),
    );
    batch.forEach((item) => inFlight.delete(item.videoId));
    if (gen === generation) {
      for (const item of batch) {
        const verdict = result.decisions?.[item.videoId]?.verdict;
        verdicts.set(item.videoId, verdict === 'hide' ? 'hide' : 'show'); // errors mean "show"
      }
    }
    sending = false;
    scan(); // apply verdicts, and send anything that arrived meanwhile
  }

  function clearMarks(): void {
    for (const card of document.querySelectorAll('[data-ww-verdict]')) card.removeAttribute('data-ww-verdict');
  }

  // If this video was opened from our home grid (opened.pending is set),
  // remember its channel once the page shows it.
  async function recordOpenedChannel(): Promise<void> {
    const pending = opened.pending;
    if (!pending || !onWatch()) return;
    const videoId = new URLSearchParams(location.search).get('v');
    if (videoId !== pending.videoId || Date.now() - pending.at > 60000) return;
    opened.pending = null;

    // YouTube updates the page in place, so wait until it's showing this
    // video, then a moment more for the channel details to catch up.
    const ready = await waitFor(() => document.querySelector(`${SELECTORS.watchPage}[video-id="${videoId}"]`), 10000);
    if (!ready) return;
    await sleep(1500);
    if (new URLSearchParams(location.search).get('v') !== videoId) return;
    const channel = readWatchChannel();
    if (!channel) return;
    // Guard against reading the previous video's channel: when both names
    // are known they must overlap (collaborations list several channels).
    const a = (channel.name || '').toLowerCase();
    const b = (pending.channel || '').toLowerCase();
    if (a && b && !a.includes(b) && !b.includes(a)) return;
    await env.stores.rememberChannel({ ...(channel.id ? { id: channel.id } : { handle: channel.handle }), name: channel.name || pending.channel });
  }
}
