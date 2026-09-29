import { describe, expect, it } from 'vitest';
import { readShorts, withoutShorts } from '../core/shorts-sequence';

const entry = (videoId: string, title?: string) => ({
  command: { reelWatchEndpoint: { videoId, ...(title ? { unserializedPrefetchData: { playerResponse: { videoDetails: { title, author: 'A' } } } } : {}) } },
});
const data = { entries: [entry('aaaaaaaaaaa', 'Hello'), entry('bbbbbbbbbbb'), { adSlotRenderer: {} }, entry('ccccccccccc')], continuation: 'NEXT' };

describe('readShorts', () => {
  it('lists the Shorts in order, with titles when YouTube sent them', () => {
    expect(readShorts(data)).toEqual([
      { id: 'aaaaaaaaaaa', title: 'Hello', channel: 'A' },
      { id: 'bbbbbbbbbbb', title: null, channel: null },
      { id: 'ccccccccccc', title: null, channel: null },
    ]);
    expect(readShorts(null)).toEqual([]);
  });
});

describe('withoutShorts', () => {
  it('takes out only the named Shorts and keeps everything else as sent', () => {
    const result = withoutShorts(data, new Set(['bbbbbbbbbbb']));
    expect(result?.removed).toEqual(['bbbbbbbbbbb']);
    expect(result?.data.continuation).toBe('NEXT');
    expect(result?.data.entries).toEqual([data.entries[0], data.entries[2], data.entries[3]]);
    expect(data.entries).toHaveLength(4); // the original is untouched
  });

  it('changes nothing if nothing is named or too few would be left', () => {
    expect(withoutShorts(data, new Set())).toBeNull();
    expect(withoutShorts({ entries: [entry('aaaaaaaaaaa'), entry('bbbbbbbbbbb')] }, new Set(['aaaaaaaaaaa']))).toBeNull();
  });
});
