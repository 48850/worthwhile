import { describe, expect, it, vi } from 'vitest';
import type { TasteProfile } from '../contracts/taste-profile';
import {
  composeRubric,
  DEFAULT_TASTE_PROFILE,
  loadTasteProfile,
  PROFILE_CACHE_MS,
  profileFromSettings,
  toServerProfile,
  validateTasteProfile,
} from '../core/profile';
import { DEFAULT_SETTINGS } from '../core/settings';
import { FakeHttp, MemoryStorage } from './helpers';

const VALID: TasteProfile = {
  interests: [
    { topic: 'chess', weight: 5, depth: 'deep' },
    { topic: 'theatre', weight: 2, depth: 'intermediate' },
  ],
  always_hide: ['reaction videos'],
  shorts_policy: { allow: ['chess puzzles'], hide: ['pranks'] },
  quality_bar: 'Depth over hype.',
  respected_creators: ['Numberphile'],
};

describe('validateTasteProfile', () => {
  it('accepts the contract shape', () => {
    expect(validateTasteProfile(VALID)).toEqual({ ok: true, profile: VALID });
    expect(validateTasteProfile(DEFAULT_TASTE_PROFILE).ok).toBe(true);
  });

  it('rejects a missing field', () => {
    const { respected_creators, ...rest } = VALID;
    const check = validateTasteProfile(rest);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors).toContain('respected_creators: missing');
  });

  it('rejects wrong types, out-of-range weights and unknown depths', () => {
    const bad = {
      ...VALID,
      interests: [
        { topic: 'chess', weight: 6, depth: 'deep' },
        { topic: 'maths', weight: 2.5, depth: 'expert' },
        { topic: '', weight: 1, depth: 'intro' },
      ],
      always_hide: 'reaction videos',
    };
    const check = validateTasteProfile(bad);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors).toEqual(
        expect.arrayContaining([
          'interests[0].weight: must be at most 5',
          'interests[1].weight: expected a whole number',
          'interests[1].depth: must be one of intro, intermediate, deep',
          'interests[2].topic: must be at least 1 character',
          'always_hide: expected an array',
        ]),
      );
    }
  });

  it('rejects extra fields, since the contract is exact', () => {
    const check = validateTasteProfile({ ...VALID, surprise: true });
    expect(check.ok).toBe(false);
  });

  it('rejects things that are not objects', () => {
    for (const value of [null, 'profile', 42, []]) expect(validateTasteProfile(value).ok).toBe(false);
  });
});

describe('toServerProfile', () => {
  const settings = { ...DEFAULT_SETTINGS, rubric: 'My rubric', interests: ['chess', 'maths'], rule: 'strict' as const, strictness: 4 };
  const corrections = [{ videoId: 'aaaaaaaaaaa', title: 'T', channel: 'C', scores: null, verdict: 'hide' as const }];

  it('sends exactly what the extension always sent when using the fallback', () => {
    const server = toServerProfile({ profile: profileFromSettings(settings), source: 'fallback' }, settings, corrections);
    expect(server).toEqual({
      rubric: 'My rubric',
      interests: ['chess', 'maths'],
      rule: 'strict',
      strictness: 4,
      examples: [{ title: 'T', channel: 'C', verdict: 'hide' }],
    });
  });

  it('writes a website profile into the rubric and orders interests by weight', () => {
    const server = toServerProfile({ profile: VALID, source: 'server' }, settings, []);
    expect(server.interests).toEqual(['chess (deep)', 'theatre']);
    expect(server.rubric).toBe(composeRubric(VALID));
    expect(server.rubric).toContain('Depth over hype.');
    expect(server.rubric).toContain('Always hide: reaction videos.');
    expect(server.rubric).toContain('Shorts to hide: pranks.');
  });

  it('keeps within the server limits', () => {
    const huge: TasteProfile = {
      ...VALID,
      quality_bar: 'x'.repeat(6000),
      interests: Array.from({ length: 40 }, (_, i) => ({ topic: `topic ${i} ${'y'.repeat(100)}`, weight: 3 as const, depth: 'intermediate' as const })),
    };
    const server = toServerProfile({ profile: huge, source: 'server' }, settings, []);
    expect(server.rubric.length).toBeLessThanOrEqual(5000);
    expect(server.interests.length).toBe(30);
    expect(Math.max(...server.interests.map((i) => i.length))).toBeLessThanOrEqual(80);
  });
});

describe('loadTasteProfile', () => {
  const url = 'https://site.example/api/taste-profile';

  it('uses the fallback when signed out, without asking the website', async () => {
    const http = new FakeHttp(() => ({ status: 200, body: VALID }));
    const reply = await loadTasteProfile({ storage: new MemoryStorage(), http, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE });
    expect(reply).toEqual({ profile: DEFAULT_TASTE_PROFILE, source: 'fallback' });
    expect(http.requests).toHaveLength(0);
  });

  it('fetches with the account token, validates and caches', async () => {
    const storage = new MemoryStorage({ authToken: 'jwt' });
    const http = new FakeHttp(() => ({ status: 200, body: VALID }));
    const reply = await loadTasteProfile({ storage, http, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE, now: () => 1000 });
    expect(reply).toEqual({ profile: VALID, source: 'server' });
    expect(http.requests[0]).toMatchObject({ method: 'GET', url, auth: 'account' });
    expect(storage.data.tasteProfileCache).toEqual({ profile: VALID, fetchedAt: 1000 });

    // Within the cache time: no second request.
    const again = await loadTasteProfile({ storage, http, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE, now: () => 1000 + PROFILE_CACHE_MS - 1 });
    expect(again.source).toBe('cache');
    expect(http.requests).toHaveLength(1);
  });

  it('fails safe on an invalid profile: the fallback, never the invalid one', async () => {
    const storage = new MemoryStorage({ authToken: 'jwt' });
    const http = new FakeHttp(() => ({ status: 200, body: { ...VALID, interests: 'everything' } }));
    const onInvalid = vi.fn();
    const reply = await loadTasteProfile({ storage, http, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE, onInvalid });
    expect(reply).toEqual({ profile: DEFAULT_TASTE_PROFILE, source: 'fallback' });
    expect(onInvalid).toHaveBeenCalledWith(['interests: expected an array']);
    expect(storage.data.tasteProfileCache).toBeUndefined();
  });

  it('uses an older cached copy when the website is unreachable, else the fallback', async () => {
    const storage = new MemoryStorage({ authToken: 'jwt', tasteProfileCache: { profile: VALID, fetchedAt: 0 } });
    const offline = new FakeHttp(() => ({ error: 'network' }));
    const later = () => PROFILE_CACHE_MS * 10;
    expect(await loadTasteProfile({ storage, http: offline, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE, now: later })).toEqual({
      profile: VALID,
      source: 'cache',
    });
    const empty = new MemoryStorage({ authToken: 'jwt' });
    const serverError = new FakeHttp(() => ({ status: 500, body: null }));
    expect((await loadTasteProfile({ storage: empty, http: serverError, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE })).source).toBe('fallback');
  });

  it('ignores a cached copy that no longer matches the contract', async () => {
    const storage = new MemoryStorage({ authToken: 'jwt', tasteProfileCache: { profile: { old: true }, fetchedAt: Date.now() } });
    const offline = new FakeHttp(() => ({ error: 'network' }));
    expect((await loadTasteProfile({ storage, http: offline, profileUrl: url, fallback: DEFAULT_TASTE_PROFILE })).source).toBe('fallback');
  });
});
