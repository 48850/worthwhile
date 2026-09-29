import { describe, expect, it } from 'vitest';
import type { TasteProfile } from '../contracts/taste-profile';
import { decide, isHallmark, matchesAny, shouldRemoveShort } from '../core/decide';
import { DEFAULT_TASTE_PROFILE, profileFromSettings } from '../core/profile';

const video = { title: 'Endgame technique, explained', channel: 'Chess Lab', isShort: false };
const short = { title: 'Crazy prank on my brother', channel: 'Prank Kings', isShort: true };
const good = { verdict: 'show' as const, scores: { interest_match: 6, substance: 6, bait: 1 } };
const great = { verdict: 'show' as const, scores: { interest_match: 9, substance: 8, bait: 1 } };
const bait = { verdict: 'hide' as const, scores: { interest_match: 2, substance: 1, bait: 9 } };

const taste: TasteProfile = {
  interests: [{ topic: 'chess', weight: 5, depth: 'deep' }],
  always_hide: ['reaction'],
  shorts_policy: { allow: ['chess'], hide: ['prank'] },
  quality_bar: 'Depth.',
  respected_creators: ['@Chess Lab'],
};

describe('decide', () => {
  it('follows the server verdict', () => {
    expect(decide({ item: video, classification: good })).toEqual({ action: 'show', reason: 'scored' });
    expect(decide({ item: video, classification: bait })).toEqual({ action: 'hide', reason: 'scored' });
  });

  it('hallmarks an exceptional show', () => {
    expect(decide({ item: video, classification: great })).toEqual({ action: 'hallmark', reason: 'scored' });
    expect(isHallmark({ interest_match: 9, substance: 8, bait: 4 })).toBe(false);
    expect(isHallmark(null)).toBe(false);
  });

  it('puts the user first: corrections, then hidden channels', () => {
    expect(decide({ item: video, override: 'show', classification: bait })).toEqual({ action: 'show', reason: 'correction' });
    expect(decide({ item: video, override: 'hide', classification: good })).toEqual({ action: 'hide', reason: 'correction' });
    expect(decide({ item: video, channelHidden: true, classification: good })).toEqual({ action: 'hide', reason: 'channel-hidden' });
    expect(decide({ item: video, override: 'show', channelHidden: true })).toEqual({ action: 'show', reason: 'correction' });
  });

  it('fails safe: a scoring error shows the item; nothing known yet means wait', () => {
    expect(decide({ item: video, failed: true })).toEqual({ action: 'show', reason: 'scoring-error' });
    expect(decide({ item: video })).toBeNull();
  });

  it('applies taste-profile rules before the server verdict', () => {
    expect(decide({ item: { ...video, title: 'Reaction to the final' }, classification: good, taste })).toEqual({ action: 'hide', reason: 'always-hide' });
    expect(decide({ item: video, classification: bait, taste })).toEqual({ action: 'hallmark', reason: 'respected-creator' });
    expect(decide({ item: short, classification: good, taste })).toEqual({ action: 'hide', reason: 'shorts-policy' });
    expect(decide({ item: { ...short, title: 'Chess puzzle', channel: 'X' }, classification: bait, taste })).toEqual({ action: 'show', reason: 'shorts-policy' });
    // Shorts policy is for Shorts only.
    expect(decide({ item: { ...video, title: 'Prank', channel: 'X' }, classification: good, taste })).toEqual({ action: 'show', reason: 'scored' });
  });

  it('changes nothing with the extension fallback profile (no extra rules)', () => {
    const fallback = profileFromSettings({ rubric: 'r', interests: ['chess'] });
    for (const input of [{ classification: good }, { classification: bait }, { failed: true }, {}]) {
      expect(decide({ item: video, ...input, taste: fallback })).toEqual(decide({ item: video, ...input }));
      expect(decide({ item: video, ...input, taste: DEFAULT_TASTE_PROFILE })).toEqual(decide({ item: video, ...input }));
    }
  });
});

describe('shouldRemoveShort', () => {
  it('removes at or above the level, never the Short on screen, never unscored', () => {
    expect(shouldRemoveShort({ bait: 8 }, 8, false)).toBe(true);
    expect(shouldRemoveShort({ bait: 7 }, 8, false)).toBe(false);
    expect(shouldRemoveShort({ bait: 10 }, 8, true)).toBe(false);
    expect(shouldRemoveShort(null, 8, false)).toBe(false);
  });
});

describe('matchesAny', () => {
  it('matches whole words, ignoring case and punctuation', () => {
    expect(matchesAny('AI slop compilation', ['ai'])).toBe(true);
    expect(matchesAny('He said so', ['ai'])).toBe(false);
    expect(matchesAny('Top-10 moments!', ['top 10'])).toBe(true);
    expect(matchesAny('anything', ['', '  '])).toBe(false);
  });
});
