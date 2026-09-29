// core/types.ts
//
// The data core works with. Nothing here knows about a browser, a page or
// an extension.

/** One video on a page, as a site adapter reads it. */
export interface FeedItem {
  /** YouTube's 11-character video ID. */
  id: string;
  title: string;
  channel: string;
  /** As shown on the card, e.g. "12:03"; '' if unknown (always for Shorts). */
  duration: string;
  isShort: boolean;
  url: string;
}

/** The model's scores for one item (0-10 each). */
export interface Scores {
  interest_match: number;
  substance: number;
  bait: number;
}

export type Verdict = 'show' | 'hide';

/** What the server decided for one item: its verdict, and the scores behind it (null if unscored). */
export interface Classification {
  verdict: Verdict;
  scores: Scores | null;
}

/** What to do with an item on the page. "hallmark": show it, marked as especially worth it. */
export type Action = 'show' | 'hide' | 'hallmark';

export type DecisionReason =
  | 'correction' // the user's own "Show it anyway" / "Wrong call"
  | 'channel-hidden' // the user's "Hide channel" list
  | 'always-hide' // taste profile: always_hide
  | 'respected-creator' // taste profile: respected_creators
  | 'shorts-policy' // taste profile: shorts_policy allow/hide
  | 'scored' // the server's verdict
  | 'bait-level' // a Short's bait score reached the removal level
  | 'unscored' // shown without a verdict (it didn't arrive in time)
  | 'scoring-error'; // scoring failed: shown (fail safe)

export interface Decision {
  action: Action;
  reason: DecisionReason;
}

/** Why a request to the server failed. The feed shows everything on any of them. */
export type ClassifyError = 'no-token' | 'bad-token' | 'network' | 'server' | 'extension-reloaded';

/** A classifier's answer: a classification per item ID, or an error. */
export type ClassifyResult = { decisions: Record<string, Classification>; error?: undefined } | { decisions?: undefined; error: ClassifyError };
