import { describe, expect, it, vi } from 'vitest';
import { HttpClassifier, MessagingClassifier, postToServer, toClassifyResult } from '../core/classifier';
import type { Messaging } from '../core/interfaces';
import { FakeHttp } from './helpers';

const item = { id: 'aaaaaaaaaaa', title: 'T', channel: 'C', duration: '1:00', isShort: false, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' };
const api = 'https://api.example';

describe('postToServer (the extension\'s long-standing error handling)', () => {
  it.each([
    [{ error: 'no-token' as const }, { error: 'no-token' }, 'no-token'],
    [{ error: 'network' as const, detail: 'down' }, { error: 'network', detail: 'down' }, 'offline'],
    [{ status: 401, body: {} }, { error: 'bad-token' }, 'bad-token'],
    [{ status: 503, body: {} }, { error: 'server', detail: 'HTTP 503' }, 'offline'],
    [{ status: 200, body: { results: {} } }, { results: {} }, 'ok'],
  ])('%j -> %j (status %s)', async (response, expected, status) => {
    const onStatus = vi.fn();
    const http = new FakeHttp(() => response);
    expect(await postToServer({ http, apiBaseUrl: api, onStatus }, '/score', { a: 1 }, 1000)).toEqual(expected);
    expect(onStatus).toHaveBeenCalledWith(status);
    expect(http.requests[0]).toMatchObject({ method: 'POST', url: `${api}/score`, body: { a: 1 }, auth: 'invite', timeoutMs: 1000 });
  });
});

describe('toClassifyResult', () => {
  it('keeps valid verdicts and passes errors through', () => {
    expect(
      toClassifyResult({
        results: {
          a: { verdict: 'hide', scores: { interest_match: 1, substance: 1, bait: 9 } },
          b: { verdict: 'show', scores: null },
          c: { verdict: 'maybe' },
        },
      }),
    ).toEqual({ decisions: { a: { verdict: 'hide', scores: { interest_match: 1, substance: 1, bait: 9 } }, b: { verdict: 'show', scores: null } } });
    expect(toClassifyResult({ error: 'bad-token' })).toEqual({ error: 'bad-token' });
    expect(toClassifyResult({ error: 'something new' })).toEqual({ error: 'server' });
    expect(toClassifyResult(undefined)).toEqual({ error: 'server' });
  });
});

describe('HttpClassifier', () => {
  it('sends the profile with the items (no isShort or url)', async () => {
    const http = new FakeHttp(() => ({ status: 200, body: { results: { [item.id]: { verdict: 'show', scores: null } } } }));
    const profile = { rubric: 'r', interests: [], rule: 'bait' as const, strictness: 2, examples: [] };
    const classifier = new HttpClassifier({ http, apiBaseUrl: api }, async () => profile);
    expect(await classifier.classify([item])).toEqual({ decisions: { [item.id]: { verdict: 'show', scores: null } } });
    expect(http.requests[0].body).toEqual({ profile, items: [{ id: item.id, title: 'T', channel: 'C', duration: '1:00' }] });
    await classifier.classifyShorts(['bbbbbbbbbbb']);
    expect(http.requests[1]).toMatchObject({ url: `${api}/score-shorts`, body: { profile, ids: ['bbbbbbbbbbb'] } });
  });
});

describe('MessagingClassifier', () => {
  it('asks the host, and treats an unreachable host as "extension reloaded"', async () => {
    const send = vi.fn().mockResolvedValueOnce({ results: {} }).mockRejectedValueOnce(new Error('Extension context invalidated'));
    const messaging = { send, onMessage: () => {} } as unknown as Messaging;
    const classifier = new MessagingClassifier(messaging);
    expect(await classifier.classify([item])).toEqual({ decisions: {} });
    expect(send).toHaveBeenCalledWith({ type: 'score', items: [{ id: item.id, title: 'T', channel: 'C', duration: '1:00' }] });
    expect(await classifier.classifyShorts(['x'])).toEqual({ error: 'extension-reloaded' });
  });
});
