import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorthwhileEvent } from '../contracts/events';
import { EventEmitter, ratingEvent, ReceiptTally } from '../core/events';

afterEach(() => vi.useRealTimers());

describe('EventEmitter', () => {
  it('sends events in batches through the sink, once per item decision', () => {
    vi.useFakeTimers();
    const sent: WorthwhileEvent[][] = [];
    const emitter = new EventEmitter((events) => sent.push(events), () => {}, false);
    emitter.itemDecided('a', false, { action: 'show', reason: 'scored' });
    emitter.itemDecided('a', false, { action: 'show', reason: 'scored' }); // re-rendered card: no second event
    emitter.itemDecided('b', true, { action: 'hide', reason: 'bait-level' });
    emitter.itemDecided('a', false, { action: 'hide', reason: 'correction' }); // a new decision: a new event
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(1);
    expect(sent[0].map((e) => [e.type, 'itemId' in e && e.itemId, 'reason' in e && e.reason])).toEqual([
      ['item_shown', 'a', 'scored'],
      ['item_filtered', 'b', 'bait-level'],
      ['item_filtered', 'a', 'correction'],
    ]);
    expect(sent[0][1]).toMatchObject({ isShort: true });
  });

  it('logs every event in development builds only', () => {
    const log = vi.fn();
    new EventEmitter(() => {}, log, true).itemDecided('a', false, { action: 'hallmark', reason: 'scored' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"type":"item_hallmarked"'));
    const quiet = vi.fn();
    new EventEmitter(() => {}, quiet, false).itemDecided('a', false, { action: 'show', reason: 'scored' });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('never throws when the host is gone', () => {
    const emitter = new EventEmitter(() => {
      throw new Error('Extension context invalidated');
    }, () => {}, false);
    emitter.emit({ type: 'session_start', sessionId: 's', at: 0 });
    expect(() => emitter.flush()).not.toThrow();
  });
});

describe('ReceiptTally', () => {
  function feed(tally: ReceiptTally, emitter: EventEmitter) {
    emitter.subscribe((e) => tally.record(e));
  }

  it('counts each item once, by its latest decision', () => {
    const tally = new ReceiptTally();
    const emitter = new EventEmitter(() => {}, () => {}, false);
    feed(tally, emitter);
    emitter.emit({ type: 'session_start', sessionId: 's1', at: 0 });
    emitter.itemDecided('v1', false, { action: 'show', reason: 'scored' });
    emitter.itemDecided('v2', false, { action: 'hallmark', reason: 'scored' });
    emitter.itemDecided('v3', false, { action: 'hide', reason: 'scored' });
    emitter.itemDecided('v1', false, { action: 'hide', reason: 'correction' }); // v1 moves to "not worth it"
    emitter.itemDecided('s1', true, { action: 'show', reason: 'scored' });
    emitter.itemDecided('s2', true, { action: 'hide', reason: 'bait-level' });
    expect(tally.receipt()).toEqual({
      sessionId: 's1',
      worthIt: 2, // v2, s1
      notWorthIt: 3, // v1, v3, s2
      hallmarked: 1,
      shortsMadeTheCut: 1,
      shortsFiltered: 1,
      ratedWorthIt: null,
    });
  });

  it('keeps the ended session and joins its rating to it; a new session starts from zero', () => {
    const tally = new ReceiptTally();
    tally.record({ type: 'session_start', sessionId: 's1', at: 0 });
    tally.record({ type: 'item_shown', itemId: 'v1', isShort: false, reason: 'scored', at: 1 });
    tally.record({ type: 'session_end', sessionId: 's1', at: 2 });
    tally.record({ type: 'session_start', sessionId: 's2', at: 3 });
    expect(tally.receipt()).toMatchObject({ sessionId: 's2', worthIt: 0, notWorthIt: 0 });
    tally.record(ratingEvent('s1', 5, 4));
    expect(tally.lastReceipt()).toMatchObject({ sessionId: 's1', worthIt: 1, ratedWorthIt: true });
    tally.record(ratingEvent('other', 1, 5)); // not the ended session: ignored
    expect(tally.lastReceipt()?.ratedWorthIt).toBe(true);
  });

  it('maps ratings: 4-5 worth it, 1-3 not', () => {
    expect(ratingEvent('s', 4).type).toBe('rated_worth_it');
    expect(ratingEvent('s', 3).type).toBe('rated_not_worth_it');
    expect(ratingEvent('s', 1)).toMatchObject({ type: 'rated_not_worth_it', rating: 1, sessionId: 's' });
  });
});
