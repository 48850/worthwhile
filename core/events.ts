// core/events.ts
//
// Analytics events (contracts/events.ts) and the session receipt.
//
//   EventEmitter  collects events and sends them to the host in batches
//                 (an 'events' message through Messaging), so any adapter can
//                 forward them. Item events are sent once per item per
//                 decision: a card YouTube re-renders doesn't count twice.
//   ReceiptTally  the session receipt, kept in memory: items worth it vs not
//                 (each item counted once, by its latest decision), hallmarks
//                 and Shorts that made the cut. When a session ends its
//                 receipt is kept, and the rating (asked on the next visit)
//                 joins it.
//
// Nothing leaves the device yet. Development builds log every event.

import type { ItemEvent, ReceiptCounts, WorthwhileEvent } from '../contracts/events';
import type { Action, Decision } from './types';

declare const __DEV__: boolean;

const FLUSH_MS = 2000;
const MAX_BATCH = 50;

export type EventSink = (events: WorthwhileEvent[]) => Promise<unknown> | unknown;

export class EventEmitter {
  private buffer: WorthwhileEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAction = new Map<string, Action>();
  private listeners: ((event: WorthwhileEvent) => void)[] = [];

  constructor(
    private sink: EventSink,
    private log: (text: string) => void = (text) => console.debug(text),
    private dev: boolean = typeof __DEV__ !== 'undefined' && __DEV__,
  ) {}

  /** Also tell this listener about every event, straight away (e.g. a ReceiptTally). */
  subscribe(listener: (event: WorthwhileEvent) => void): void {
    this.listeners.push(listener);
  }

  /** item_shown / item_filtered / item_hallmarked for a decision, unless it's this item's decision already. */
  itemDecided(itemId: string, isShort: boolean, decision: Decision): void {
    if (this.lastAction.get(itemId) === decision.action) return;
    this.lastAction.set(itemId, decision.action);
    const type: ItemEvent['type'] = decision.action === 'hide' ? 'item_filtered' : decision.action === 'hallmark' ? 'item_hallmarked' : 'item_shown';
    this.emit({ type, itemId, isShort, reason: decision.reason, at: Date.now() });
  }

  emit(event: WorthwhileEvent): void {
    if (this.dev) this.log(`[worthwhile] ${JSON.stringify(event)}`);
    for (const listener of this.listeners) listener(event);
    this.buffer.push(event);
    if (this.buffer.length >= MAX_BATCH) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Sends whatever is waiting. Never throws: analytics must not break filtering. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.buffer.length) return;
    const events = this.buffer;
    this.buffer = [];
    try {
      Promise.resolve(this.sink(events)).catch(() => {});
    } catch {
      // the host went away (e.g. the extension was reloaded)
    }
  }
}

export class ReceiptTally {
  private sessionId: string | null = null;
  private items = new Map<string, { action: Action; isShort: boolean }>();
  /** The last session's receipt, kept after it ends so its rating (asked on the next visit) can join it. */
  private ended: ReceiptCounts | null = null;

  /** Feed it every event (EventEmitter.subscribe, or the host's 'events' messages). */
  record(event: WorthwhileEvent): void {
    switch (event.type) {
      case 'session_start':
        this.sessionId = event.sessionId;
        this.items.clear();
        break;
      case 'item_shown':
      case 'item_filtered':
      case 'item_hallmarked': {
        const action: Action = event.type === 'item_filtered' ? 'hide' : event.type === 'item_hallmarked' ? 'hallmark' : 'show';
        this.items.set(event.itemId, { action, isShort: event.isShort });
        break;
      }
      case 'session_end':
        this.ended = { ...this.receipt(), sessionId: event.sessionId };
        this.sessionId = null;
        this.items.clear();
        break;
      case 'rated_worth_it':
      case 'rated_not_worth_it':
        if (this.ended && this.ended.sessionId === event.sessionId) this.ended.ratedWorthIt = event.type === 'rated_worth_it';
        break;
    }
  }

  /** The last finished session's receipt, with its rating once given; null before any session has ended. */
  lastReceipt(): ReceiptCounts | null {
    return this.ended && { ...this.ended };
  }

  /** The current session's receipt so far. */
  receipt(): ReceiptCounts {
    let worthIt = 0;
    let notWorthIt = 0;
    let hallmarked = 0;
    let shortsMadeTheCut = 0;
    let shortsFiltered = 0;
    for (const { action, isShort } of this.items.values()) {
      if (action === 'hide') {
        notWorthIt++;
        if (isShort) shortsFiltered++;
      } else {
        worthIt++;
        if (action === 'hallmark') hallmarked++;
        if (isShort) shortsMadeTheCut++;
      }
    }
    return { sessionId: this.sessionId, worthIt, notWorthIt, hallmarked, shortsMadeTheCut, shortsFiltered, ratedWorthIt: null };
  }
}

/** A session rating (1-5) as an event: 4-5 is worth it, 1-3 isn't. */
export function ratingEvent(sessionId: string, rating: number, at = Date.now()): WorthwhileEvent {
  return { type: rating >= 4 ? 'rated_worth_it' : 'rated_not_worth_it', sessionId, rating, at };
}
