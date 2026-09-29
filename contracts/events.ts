// contracts/events.ts
//
// Analytics events, for the session receipt and ratings. Core emits them
// through Messaging (an 'events' message, batched), so any adapter can
// forward them. For now nothing is sent anywhere: they're tallied in memory
// and logged in development builds.
// Like everything else Worthwhile records: IDs, counts and reasons only,
// never titles.

import type { DecisionReason } from '../core/types';

export type ItemEventType = 'item_shown' | 'item_filtered' | 'item_hallmarked';
export type RatingEventType = 'rated_worth_it' | 'rated_not_worth_it';
export type SessionEventType = 'session_start' | 'session_end';

export interface ItemEvent {
  type: ItemEventType;
  itemId: string;
  isShort: boolean;
  reason: DecisionReason;
  at: number; // unix ms
}

/** The session rating (1-5): 4-5 is "worth it", 1-3 "not worth it". */
export interface RatingEvent {
  type: RatingEventType;
  sessionId: string;
  rating: number;
  at: number;
}

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  at: number;
  /** session_end only: seconds with YouTube on screen. */
  durationS?: number;
}

export type WorthwhileEvent = ItemEvent | RatingEvent | SessionEvent;

/** The receipt for the current session (core/events.ts ReceiptTally). */
export interface ReceiptCounts {
  sessionId: string | null;
  /** Distinct items shown or hallmarked (their latest decision). */
  worthIt: number;
  /** Distinct items filtered out. */
  notWorthIt: number;
  hallmarked: number;
  /** Shorts that were shown. */
  shortsMadeTheCut: number;
  shortsFiltered: number;
  /** The session's rating, if given: true = worth it. */
  ratedWorthIt: boolean | null;
}
