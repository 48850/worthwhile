import { describe, expect, it } from 'vitest';
import type { VideoClassification } from '../contracts/classification';
import type { TasteProfile } from '../contracts/taste-profile';
import { TOPIC_IDS, TOPICS } from '../contracts/topics';
import { appeal, DEFAULT_RANGE, fitNeeded, judge, MAX_APPEAL, prepareProfile, QUALITY_FLOOR, relevance, whyLine } from '../core/relevance';

const taste = (overrides: Partial<TasteProfile> = {}): TasteProfile => ({
  interests: [
    { topic: 'chess', weight: 5, depth: 'deep' },
    { topic: 'science', weight: 3, depth: 'intermediate' },
    { topic: 'independent watchmaking', weight: 2, depth: 'intermediate' },
  ],
  always_hide: [],
  shorts_policy: { allow: [], hide: [] },
  quality_bar: '',
  respected_creators: [],
  ...overrides,
});

const video = (overrides: Partial<VideoClassification> = {}): VideoClassification => ({
  quality: 0.7,
  junk: null,
  topics: ['chess'],
  tags: [],
  depth: 'deep',
  format: 'analysis',
  reason: 'A grandmaster walks through a rook endgame.',
  ...overrides,
});

const item = { title: 'The rook endgame everyone gets wrong', channel: 'Endgame Room', isShort: false };

function verdict(c: VideoClassification | null, profile = taste(), range = DEFAULT_RANGE, it = item) {
  return judge({ item: it, classification: c, profile: prepareProfile(profile), range });
}

describe('topics contract', () => {
  it('has unique ids, and every alias is already normalised', () => {
    expect(new Set(TOPIC_IDS).size).toBe(TOPIC_IDS.length);
    for (const topic of TOPICS) for (const alias of topic.aliases) expect(alias).toMatch(/^[\p{Ll}\p{N}]+( [\p{Ll}\p{N}]+)*$/u);
  });
});

describe('Range', () => {
  it('needs the most fit at "Only my interests" and none at "Anything good"', () => {
    expect(fitNeeded(0)).toBeCloseTo(0.6);
    expect(fitNeeded(1)).toBe(0);
    expect(fitNeeded(5)).toBe(0); // clamped
  });

  it('lets in videos outside the interests by quality as Range slides right: excellent first, light last', () => {
    const outside = (quality: number) => video({ topics: ['history'], depth: 'intermediate', quality });
    const ranges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    const firstShownAt = (quality: number) => ranges.find((r) => verdict(outside(quality), taste(), r).action === 'show')!;
    expect(firstShownAt(1)).toBeGreaterThan(0); // never at "Only my interests"
    expect(firstShownAt(0.9)).toBeLessThan(firstShownAt(0.7));
    expect(firstShownAt(0.7)).toBeLessThan(firstShownAt(0.5));
    expect(firstShownAt(0.5)).toBeGreaterThanOrEqual(0.9);
    expect(verdict(outside(0.9), taste(), 0.5)).toMatchObject({ action: 'show', reason: 'good-enough' });
    expect(verdict(outside(0.5), taste(), 1)).toMatchObject({ action: 'show', reason: 'good-enough' }); // not "in-range" with no interest
    expect(appeal(1)).toBeCloseTo(MAX_APPEAL);
    expect(appeal(QUALITY_FLOOR)).toBe(0);
  });

  it('shows a good video off the user\'s interests only towards "Anything good"', () => {
    const cooking = video({ topics: ['food'], depth: 'intro', quality: 0.6, reason: 'A chef explains why bread rises.' });
    expect(verdict(cooking, taste(), 0).action).toBe('cut');
    expect(verdict(cooking, taste(), 0).reason).toBe('off-range');
    expect(verdict(cooking, taste(), 1).action).toBe('show');
  });

  it('never brings junk or low-effort videos back, even at "Anything good"', () => {
    expect(verdict(video({ junk: 'ragebait' }), taste(), 1)).toMatchObject({ action: 'cut', reason: 'junk' });
    expect(verdict(video({ quality: QUALITY_FLOOR - 0.1 }), taste(), 1)).toMatchObject({ action: 'cut', reason: 'below-floor' });
  });
});

describe('relevance', () => {
  const profile = prepareProfile(taste());

  it('scores a direct topic match at the interest\'s weight and depth', () => {
    expect(relevance(video(), item, profile).score).toBeCloseTo(1); // chess, weight 5, deep = deep
    expect(relevance(video({ depth: 'intro' }), item, profile).score).toBeCloseTo(0.75); // two depth steps away
  });

  it('matches a topic inside a group the user named ("science" covers astronomy)', () => {
    const r = relevance(video({ topics: ['astronomy'], depth: 'intermediate' }), item, profile);
    expect(r.interest?.topic).toBe('science');
    expect(r.score).toBeCloseTo(0.8 * 0.85); // group match, weight 3
  });

  it('counts a secondary topic for a little less than the main one', () => {
    const main = relevance(video({ topics: ['chess'] }), item, profile).score;
    const secondary = relevance(video({ topics: ['history', 'chess'] }), item, profile).score;
    expect(secondary).toBeLessThan(main);
    expect(secondary).toBeGreaterThan(0.8);
  });

  it('matches a multi-word interest through the topic aliases', () => {
    const r = relevance(video({ topics: ['horology'], depth: 'intermediate' }), item, profile);
    expect(r.interest?.topic).toBe('independent watchmaking');
  });

  it("falls back to the interest's words in the title when no topic fits", () => {
    const p = prepareProfile(taste({ interests: [{ topic: 'Kepler', weight: 3, depth: 'intermediate' }] }));
    const r = relevance(video({ topics: ['history'], depth: 'intermediate' }), { title: 'How Kepler found the ellipse', channel: '' }, p);
    expect(r.score).toBeCloseTo(0.6 * 0.85);
  });
});

describe('exclusions', () => {
  it('reads exclusions written in the user\'s own words', () => {
    const p = taste({ always_hide: ['reaction videos', 'generic top-10 lists', 'hustle/motivation/get-rich content'] });
    expect(verdict(video({ format: 'reaction' }), p)).toMatchObject({ action: 'cut', reason: 'excluded', matched: 'reaction videos' });
    expect(verdict(video({ format: 'list' }), p)).toMatchObject({ action: 'cut', matched: 'generic top-10 lists' });
    expect(verdict(video({ topics: ['self-improvement', 'chess'] }), p)).toMatchObject({ action: 'cut', matched: 'hustle/motivation/get-rich content' });
  });

  it('matches "drama" as drama farming, not the word in a theatre title', () => {
    const p = taste({ interests: [{ topic: 'theatre', weight: 4, depth: 'intermediate' }], always_hide: ['drama and gossip'] });
    const greekDrama = video({ topics: ['theatre'], depth: 'intermediate', format: 'lecture' });
    expect(verdict(greekDrama, p, DEFAULT_RANGE, { title: 'How Greek drama invented the stage', channel: 'Second Row', isShort: false }).action).toBe('show');
  });

  it('falls back to a plain text match for a term with no category', () => {
    const p = taste({ always_hide: ['Kardashians'] });
    expect(verdict(video(), p, 1, { ...item, title: 'The Kardashians play chess' })).toMatchObject({ action: 'cut', matched: 'Kardashians' });
    expect(verdict(video(), p, 1).action).toBe('show');
  });

  it('applies shorts_policy only to Shorts', () => {
    const p = taste({ shorts_policy: { allow: ['cooking'], hide: ['gaming'] } });
    const short = { ...item, isShort: true };
    expect(verdict(video({ topics: ['video-games'] }), p, 1, short)).toMatchObject({ action: 'cut', matched: 'gaming' });
    expect(verdict(video({ topics: ['video-games'] }), p, 1).action).toBe('show');
    expect(verdict(video({ topics: ['food'], depth: 'intro' }), p, 0, short)).toMatchObject({ action: 'show', reason: 'shorts-allowed' });
  });
});

describe('judge', () => {
  it("always shows a channel the user loves (respected_creators: never hidden)", () => {
    const p = taste({ respected_creators: ['@Endgame Room'] });
    expect(verdict(video({ junk: 'misleading_clickbait' }), p)).toMatchObject({ action: 'show', reason: 'loved-creator' });
  });

  it('shows an unclassified video (fail open)', () => {
    expect(verdict(null)).toMatchObject({ action: 'show', reason: 'unclassified' });
  });

  it('explains every decision in one line', () => {
    expect(whyLine(verdict(video()), video())).toBe('Chess: A grandmaster walks through a rook endgame.');
    const junk = video({ junk: 'ragebait', reason: 'A staged argument filmed to provoke.' });
    expect(whyLine(verdict(junk), junk)).toBe('Ragebait: A staged argument filmed to provoke.');
  });
});
