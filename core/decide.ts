// core/decide.ts
//
// Taste-profile scoring: given what's known about an item, decide show,
// hide or hallmark. The model's scores come from the server (the Worker
// decides show/hide from them, see shared/prompt.js verdictFor); this adds
// the user's own rules on top.
//
// In order, the first that applies wins:
//   1. the user's correction ("Show it anyway" / "Wrong call");
//   2. "Hide channel";
//   3. the taste profile: always_hide, then respected_creators, then (for
//      Shorts) shorts_policy;
//   4. the server's verdict; a "show" whose scores are exceptional is a
//      hallmark;
//   5. scoring failed: show (fail safe).
// Nothing known yet: null, and the caller keeps waiting (or shows the item
// when it stops waiting).
//
// With no profile rules (the Chrome extension's fallback profile has none),
// this is exactly the order the extension always used.

import type { TasteProfile } from '../contracts/taste-profile';
import type { Classification, Decision, FeedItem, Scores, Verdict } from './types';

/** A "show" is hallmarked when it's squarely on an interest, substantial, and not bait. */
export const HALLMARK = { minInterest: 8, minSubstance: 7, maxBait: 3 };

export interface DecideInput {
  item: Pick<FeedItem, 'title' | 'channel' | 'isShort'>;
  override?: Verdict | null;
  channelHidden?: boolean;
  classification?: Classification | null;
  failed?: boolean;
  /** Profile rules to apply; null or undefined: none. */
  taste?: TasteProfile | null;
}

export function decide({ item, override, channelHidden, classification, failed, taste }: DecideInput): Decision | null {
  if (override) return { action: override, reason: 'correction' };
  if (channelHidden) return { action: 'hide', reason: 'channel-hidden' };

  if (taste) {
    const text = `${item.title} ${item.channel}`;
    if (matchesAny(text, taste.always_hide)) return { action: 'hide', reason: 'always-hide' };
    if (item.channel && taste.respected_creators.some((c) => sameName(c, item.channel))) {
      return { action: 'hallmark', reason: 'respected-creator' };
    }
    if (item.isShort) {
      if (matchesAny(text, taste.shorts_policy.hide)) return { action: 'hide', reason: 'shorts-policy' };
      if (matchesAny(text, taste.shorts_policy.allow)) return { action: 'show', reason: 'shorts-policy' };
    }
  }

  if (classification) {
    if (classification.verdict === 'hide') return { action: 'hide', reason: 'scored' };
    return { action: isHallmark(classification.scores) ? 'hallmark' : 'show', reason: 'scored' };
  }
  if (failed) return { action: 'show', reason: 'scoring-error' };
  return null;
}

export function isHallmark(scores: Scores | null | undefined): boolean {
  return Boolean(
    scores &&
      scores.interest_match >= HALLMARK.minInterest &&
      scores.substance >= HALLMARK.minSubstance &&
      scores.bait <= HALLMARK.maxBait,
  );
}

/**
 * Whether a Short should be taken out of YouTube's upcoming list:
 * its bait score reached the user's removal level. Never the Short on screen.
 */
export function shouldRemoveShort(scores: Pick<Scores, 'bait'> | null | undefined, level: number, isOnScreen: boolean): boolean {
  return !isOnScreen && scores != null && scores.bait >= level;
}

/** Case-insensitive, whole words: "AI" matches "AI slop", not "said". */
export function matchesAny(text: string, terms: string[]): boolean {
  const haystack = ` ${normalise(text)} `;
  return terms.some((term) => {
    const needle = normalise(term);
    return needle !== '' && haystack.includes(` ${needle} `);
  });
}

function sameName(a: string, b: string): boolean {
  return normalise(a.replace(/^@/, '')) === normalise(b.replace(/^@/, ''));
}

// Lower case, with anything that isn't a letter or digit turned into a single space.
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
