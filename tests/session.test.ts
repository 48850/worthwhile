// The M4 session logic, as tested before the move to TypeScript
// (the same scenarios as the original sessions-test).
import { describe, expect, it } from 'vitest';
import type { WorthwhileEvent } from '../contracts/events';
import { createSessionTracker, SESSION_GAP_MS, type SessionRecord } from '../core/session';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { MemoryStorage } from './helpers';

function setup() {
  let time = Date.UTC(2026, 8, 26, 10, 0, 0);
  let ids = 0;
  const settings: Settings = { ...DEFAULT_SETTINGS, token: 't', enabled: true };
  const local = new MemoryStorage();
  const posts: SessionRecord[][] = [];
  const alarms: number[] = [];
  const events: WorthwhileEvent[] = [];
  let postFails = false;
  const tracker = createSessionTracker({
    local,
    loadSettings: async () => ({ ...settings }),
    postSessions: async (sessions) => {
      if (postFails) return { error: 'network' };
      posts.push(structuredClone(sessions));
      return { saved: sessions.length };
    },
    scheduleEnd: (when) => alarms.push(when),
    emit: (e) => events.push(e),
    now: () => time,
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  return {
    tracker,
    settings,
    local,
    posts,
    alarms,
    events,
    tick: (ms: number) => (time += ms),
    failPosts: (fail: boolean) => (postFails = fail),
    beat: (active: boolean, counts: Record<string, number> = {}) => tracker.onActivity({ active, counts }),
  };
}

describe('session tracking', () => {
  it('accumulates on-screen time and counts, ends after 30 minutes away, asks once, and takes the rating', async () => {
    const t = setup();
    let reply = await t.beat(true, { shown: 5, hidden: 2 });
    expect(reply.sessionMinutes).toBe(0);
    for (let i = 0; i < 40; i++) {
      t.tick(15000);
      reply = await t.beat(true, { shortsSeen: 1 });
    }
    expect(reply.sessionMinutes).toBe(10);
    t.tick(15000);
    await t.beat(true, { corrections: 1, shortsRemoved: 3 });
    const session = (t.local.data.session as any);
    expect(session).toMatchObject({ shown: 5, hidden: 2, shortsSeen: 40, corrections: 1, shortsRemoved: 3 });
    expect(Math.round(session.activeSeconds)).toBe(615);

    // A hidden page adds counts, not time.
    t.tick(10 * 60 * 1000);
    await t.beat(false, { shown: 1 });
    expect(Math.round((t.local.data.session as any).activeSeconds)).toBe(615);

    // Back after 30+ minutes: the old session is sent and the rating asked.
    t.tick(31 * 60 * 1000);
    reply = await t.beat(true);
    expect(t.posts).toHaveLength(1);
    const record = t.posts[0][0];
    expect(record).toMatchObject({ duration_s: 615, filter_on: 1, items_shown: 6, shorts_removed: 3, rating: null });
    expect(record.started_at % 60).toBe(0);
    expect(reply.askRating).toEqual({ sessionId: record.session_id, minutes: 10 });
    t.tick(15000);
    expect((await t.beat(true)).askRating).toBeUndefined(); // asked once only

    expect(await t.tracker.onRate({ sessionId: record.session_id, rating: 4 })).toEqual({ ok: true });
    expect(t.posts[1][0]).toMatchObject({ session_id: record.session_id, rating: 4 });
    expect(t.events.map((e) => e.type)).toEqual(['session_start', 'session_end', 'session_start', 'rated_worth_it']);
  });

  it('offers the filter once after 25 minutes with it off, and once for fast Shorts', async () => {
    const t = setup();
    t.settings.enabled = false;
    let offers = 0;
    for (let i = 0; i < 110; i++) {
      t.tick(15000);
      if ((await t.beat(true)).offerFilter) offers++;
    }
    expect(offers).toBe(1);
    expect(await t.tracker.onFatigue()).toEqual({ offer: false }); // already offered this session
  });

  it('ends a session by the scheduled end when YouTube isn\'t opened again; skip sends nothing more', async () => {
    const t = setup();
    for (let i = 0; i < 8; i++) {
      t.tick(15000);
      await t.beat(true);
    }
    expect(t.alarms.at(-1)).toBe((t.local.data.session as any).lastActiveAt + SESSION_GAP_MS + 1000);
    t.tick(31 * 60 * 1000);
    await t.tracker.onSessionAlarm();
    expect(t.posts).toHaveLength(1);
    expect(t.local.data.session).toBeNull();
    const ended = (t.local.data.endedSession as any).session_id;
    t.tick(60000);
    expect((await t.beat(true)).askRating?.sessionId).toBe(ended);
    await t.tracker.onRate({ sessionId: ended, rating: null });
    expect(t.posts).toHaveLength(1);
  });

  it('keeps unsent records in the outbox and sends them with the next one', async () => {
    const t = setup();
    t.failPosts(true);
    for (let i = 0; i < 8; i++) {
      t.tick(15000);
      await t.beat(true);
    }
    t.tick(31 * 60 * 1000);
    await t.tracker.onSessionAlarm();
    expect(t.local.data.sessionOutbox).toHaveLength(1);
    t.failPosts(false);
    for (let i = 0; i < 8; i++) {
      t.tick(15000);
      await t.beat(true);
    }
    t.tick(31 * 60 * 1000);
    await t.tracker.onSessionAlarm();
    expect(t.local.data.sessionOutbox).toHaveLength(0);
    expect(t.posts.at(-1)).toHaveLength(2);
  });
});
