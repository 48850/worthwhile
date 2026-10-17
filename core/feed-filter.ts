// core/feed-filter.ts
//
// A feed filter for any site, through its SiteAdapter: read the cards,
// classify what's new, then show, hide or hallmark each one and emit its
// event. This is what the iOS WebView runs (with sites/youtube-mobile).
// The Chrome extension's desktop home feed uses its own controller
// (sites/youtube-desktop/feed.ts), which adds desktop-only behaviour: cards
// kept invisible in their slots until scored, bait left in place when it's
// already on screen, the Hidden drawer and "Worth your time".
//
// Fail safe: a card waiting for its verdict is shown after revealAfterMs;
// any classifier error shows everything it was asked about.

import type { TasteProfile } from '../contracts/taste-profile';
import { tally } from './counts';
import { decide } from './decide';
import type { EventEmitter } from './events';
import type { Classifier, SiteAdapter } from './interfaces';
import type { Classification, FeedItem, Verdict } from './types';

export interface FeedFilterState {
  active: boolean;
  taste: TasteProfile | null;
  hiddenChannels: string[];
  overrides: Map<string, Verdict>;
}

export interface FeedFilterOptions {
  site: SiteAdapter;
  classifier: Classifier;
  events: EventEmitter;
  /** Read fresh on every pass, so settings changes apply straight away. */
  state: () => FeedFilterState;
  batchSize?: number;
  revealAfterMs?: number;
  scanDelayMs?: number;
}

export function createFeedFilter(options: FeedFilterOptions) {
  const { site, classifier, events, state } = options;
  const batchSize = options.batchSize ?? 20;
  const revealAfterMs = options.revealAfterMs ?? 2500;
  const scanDelayMs = options.scanDelayMs ?? 50;

  const classifications = new Map<string, Classification>();
  const failed = new Set<string>();
  const inFlight = new Set<string>();
  const firstSeen = new Map<string, number>();
  const revealed = new Set<string>(); // shown before a verdict: never hidden afterwards (nothing vanishes under the user's eyes)
  let root: ParentNode | null = null;
  let stopObserving: (() => void) | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let revealTimer: ReturnType<typeof setInterval> | null = null;

  function start(feedRoot: ParentNode & Node): void {
    stop();
    root = feedRoot;
    stopObserving = site.observe(feedRoot, () => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scan();
      }, scanDelayMs);
    });
    revealTimer = setInterval(scan, 500);
    scan();
  }

  function stop(): void {
    stopObserving?.();
    stopObserving = null;
    if (scanTimer) clearTimeout(scanTimer);
    if (revealTimer) clearInterval(revealTimer);
    scanTimer = revealTimer = null;
    root = null;
  }

  /** One pass over the cards: decide what can be decided, queue the rest. */
  function scan(): void {
    if (!root) return;
    const { active, taste, hiddenChannels, overrides } = state();
    const waiting: FeedItem[] = [];
    const now = Date.now();
    for (const card of site.findItems(root)) {
      const item = site.readItem(card);
      if (!item) {
        site.showItem(card); // not ours to judge
        continue;
      }
      if (!active) {
        site.showItem(card);
        continue;
      }
      const channel = item.channel.toLowerCase();
      const decision = decide({
        item,
        override: overrides.get(item.id),
        channelHidden: channel !== '' && hiddenChannels.some((c) => c.toLowerCase() === channel),
        classification: classifications.get(item.id),
        failed: failed.has(item.id),
        taste,
      });
      if (decision) {
        if (decision.action === 'hide' && revealed.has(item.id) && decision.reason === 'scored') continue; // left in place
        if (decision.action === 'hide') site.hideItem(card);
        else {
          site.showItem(card);
          if (decision.action === 'hallmark') site.markHallmarked(card);
        }
        tally(decision.action === 'hide' ? 'hidden' : 'shown', item.id); // for the session record
        events.itemDecided(item.id, item.isShort, decision);
        continue;
      }
      if (!firstSeen.has(item.id)) firstSeen.set(item.id, now);
      if (now - firstSeen.get(item.id)! >= revealAfterMs && !revealed.has(item.id)) {
        revealed.add(item.id);
        site.showItem(card); // waited long enough: shown unscored
        events.itemDecided(item.id, item.isShort, { action: 'show', reason: 'unscored' });
      }
      if (!inFlight.has(item.id)) waiting.push(item);
    }
    for (let i = 0; i < waiting.length; i += batchSize) void send(waiting.slice(i, i + batchSize));
  }

  async function send(batch: FeedItem[]): Promise<void> {
    batch.forEach((item) => inFlight.add(item.id));
    const result = await classifier.classify(batch);
    batch.forEach((item) => inFlight.delete(item.id));
    for (const item of batch) {
      const classification = result.decisions?.[item.id];
      if (classification) classifications.set(item.id, classification);
      else failed.add(item.id); // any error: shown
    }
    scan();
  }

  return { start, stop, scan };
}
