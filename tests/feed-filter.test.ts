// The generic feed filter (iOS path), driven through a fake SiteAdapter:
// no DOM needed, which is the point of the interface.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorthwhileEvent } from '../contracts/events';
import { EventEmitter } from '../core/events';
import { createFeedFilter, type FeedFilterState } from '../core/feed-filter';
import type { Classifier, SiteAdapter } from '../core/interfaces';
import type { ClassifyResult, FeedItem } from '../core/types';

afterEach(() => vi.useRealTimers());

type Card = { item: FeedItem | null; state: 'waiting' | 'shown' | 'hidden'; hallmark: boolean } & Element;

function card(id: string | null, title = 'A video'): Card {
  const item = id ? { id, title, channel: 'Chan', duration: '', isShort: false, url: '' } : null;
  return { item, state: 'waiting', hallmark: false } as Card;
}

function fakeSite(cards: Card[]): SiteAdapter {
  return {
    findItems: () => cards,
    readItem: (c) => (c as Card).item,
    hideItem: (c) => ((c as Card).state = 'hidden'),
    showItem: (c) => ((c as Card).state = 'shown'),
    markHallmarked: (c) => ((c as Card).hallmark = true),
    observe: () => () => {},
  };
}

function classifierReturning(result: (ids: string[]) => ClassifyResult): Classifier & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    classify: async (items) => {
      calls.push(items.map((i) => i.id));
      return result(items.map((i) => i.id));
    },
    classifyShorts: async () => ({ decisions: {} }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function run(cards: Card[], classifier: Classifier, state: Partial<FeedFilterState> = {}) {
  const events: WorthwhileEvent[] = [];
  const emitter = new EventEmitter(() => {}, () => {}, false);
  emitter.subscribe((e) => events.push(e));
  const filter = createFeedFilter({
    site: fakeSite(cards),
    classifier,
    events: emitter,
    state: () => ({ active: true, taste: null, hiddenChannels: [], overrides: new Map(), ...state }),
    revealAfterMs: 1000,
  });
  filter.start({} as ParentNode & Node);
  return { filter, events };
}

describe('feed filter', () => {
  it('hides bait, shows the rest, hallmarks the best, and emits one event each', async () => {
    const cards = [card('good0000001'), card('bait0000001'), card('best0000001'), card(null)];
    const classifier = classifierReturning(() => ({
      decisions: {
        good0000001: { verdict: 'show', scores: { interest_match: 5, substance: 5, bait: 1 } },
        bait0000001: { verdict: 'hide', scores: { interest_match: 1, substance: 1, bait: 9 } },
        best0000001: { verdict: 'show', scores: { interest_match: 9, substance: 9, bait: 0 } },
      },
    }));
    const { filter, events } = run(cards, classifier);
    expect(cards[3].state).toBe('shown'); // not a plain video: not ours to judge
    await flush();
    expect(cards.map((c) => c.state)).toEqual(['shown', 'hidden', 'shown', 'shown']);
    expect(cards[2].hallmark).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['item_shown', 'item_filtered', 'item_hallmarked']);
    filter.scan();
    expect(events).toHaveLength(3); // no repeats
    filter.stop();
  });

  it('fails safe: a classifier error shows everything', async () => {
    const cards = [card('aaaaaaaaaaa'), card('bbbbbbbbbbb')];
    const { filter, events } = run(cards, classifierReturning(() => ({ error: 'network' })));
    await flush();
    expect(cards.map((c) => c.state)).toEqual(['shown', 'shown']);
    expect(events.map((e) => [e.type, 'reason' in e && e.reason])).toEqual([
      ['item_shown', 'scoring-error'],
      ['item_shown', 'scoring-error'],
    ]);
    filter.stop();
  });

  it('shows a card that waited too long, and never hides it afterwards', async () => {
    vi.useFakeTimers();
    let answer: (r: ClassifyResult) => void = () => {};
    const slow: Classifier = {
      classify: () => new Promise((resolve) => (answer = resolve)),
      classifyShorts: async () => ({ decisions: {} }),
    };
    const cards = [card('late0000001')];
    const { filter } = run(cards, slow);
    expect(cards[0].state).toBe('waiting');
    vi.advanceTimersByTime(1000);
    expect(cards[0].state).toBe('shown');
    answer({ decisions: { late0000001: { verdict: 'hide', scores: null } } });
    await vi.advanceTimersByTimeAsync(10);
    expect(cards[0].state).toBe('shown'); // left in place
    filter.stop();
  });

  it('does nothing but show while the filter is off', async () => {
    const cards = [card('aaaaaaaaaaa')];
    const classifier = classifierReturning(() => ({ decisions: {} }));
    const { filter } = run(cards, classifier, { active: false });
    await flush();
    expect(cards[0].state).toBe('shown');
    expect(classifier.calls).toHaveLength(0);
    filter.stop();
  });

  it('applies the user\'s corrections and hidden channels without asking the server', async () => {
    const cards = [card('aaaaaaaaaaa'), card('bbbbbbbbbbb')];
    const classifier = classifierReturning(() => ({ decisions: {} }));
    const { filter } = run(cards, classifier, { overrides: new Map([['aaaaaaaaaaa', 'hide']]), hiddenChannels: ['chan'] });
    expect(cards.map((c) => c.state)).toEqual(['hidden', 'hidden']);
    expect(classifier.calls).toHaveLength(0);
    filter.stop();
  });
});
