// core/host.ts: the message handling both adapters share.
import { describe, expect, it } from 'vitest';
import type { WorthwhileEvent } from '../contracts/events';
import { createHost } from '../core/host';
import { createStores, DEFAULT_SETTINGS } from '../core/settings';
import { FakeHttp, MemoryStorage } from './helpers';

function setup(options: { given?: unknown; http?: FakeHttp; settings?: Record<string, unknown> } = {}) {
  const settings = new MemoryStorage({ ...DEFAULT_SETTINGS, token: 'tok', rubric: 'My rubric', interests: ['chess'], ...options.settings });
  const local = new MemoryStorage();
  const status = new MemoryStorage();
  const events: WorthwhileEvent[] = [];
  const http = options.http || new FakeHttp(() => ({ status: 200, body: { results: {} } }));
  const host = createHost({
    stores: createStores(settings, local),
    http,
    config: { apiBaseUrl: 'https://api.example', profileUrl: '' },
    statusStore: status,
    scheduleSessionEnd: () => {},
    onEvents: (e) => events.push(...e),
    givenProfile: () => options.given,
  });
  return { host, http, status, events };
}

describe('host', () => {
  it('sends exactly the old profile when there is no website profile', async () => {
    const { host, http } = setup();
    await host.handle({ type: 'score', items: [{ id: 'aaaaaaaaaaa', title: 'T', channel: 'C', duration: '' }] });
    expect(http.requests[0].body).toEqual({
      profile: { rubric: 'My rubric', interests: ['chess'], rule: 'bait', strictness: 2, examples: [] },
      items: [{ id: 'aaaaaaaaaaa', title: 'T', channel: 'C', duration: '' }],
    });
  });

  it('fails safe on an invalid profile from the app: the user\'s own settings are used', async () => {
    const { host } = setup({ given: { interests: 'all of them' } });
    expect(await host.handle({ type: 'profile' })).toMatchObject({ source: 'fallback', profile: { quality_bar: 'My rubric' } });
  });

  it('uses a valid profile from the app', async () => {
    const given = { interests: [], always_hide: ['drama'], shorts_policy: { allow: [], hide: [] }, quality_bar: 'Depth.', respected_creators: [] };
    const { host, http } = setup({ given });
    expect(await host.handle({ type: 'profile' })).toEqual({ profile: given, source: 'server' });
    await host.handle({ type: 'scoreShorts', ids: ['bbbbbbbbbbb'] });
    expect((http.requests[0].body as any).profile.rubric).toBe('Depth.\nAlways hide: drama.');
  });

  it('reports errors as before, and remembers the server status', async () => {
    const { host, status } = setup({ http: new FakeHttp(() => ({ error: 'network', detail: 'down' })) });
    expect(await host.handle({ type: 'source' })).toEqual({ error: 'network', detail: 'down' });
    expect(status.data.serverStatus).toBe('offline');
    const noToken = setup({ settings: { token: '' } });
    expect(await noToken.host.handle({ type: 'checkServer' })).toEqual({ serverStatus: 'no-token' });
  });

  it('passes events on, and ignores messages it doesn\'t know', async () => {
    const { host, events } = setup();
    const event: WorthwhileEvent = { type: 'item_shown', itemId: 'a', isShort: false, reason: 'scored', at: 1 };
    expect(await host.handle({ type: 'events', events: [event] })).toEqual({ ok: true });
    expect(events).toEqual([event]);
    expect(host.handle({ type: 'nonsense' } as any)).toBeUndefined();
  });
});
