// core/session.ts
//
// The behaviour layer's bookkeeping (M4). The page sends a heartbeat every
// 15 s while YouTube is on screen, carrying counts since the last one. From
// those this keeps the current session:
//   - it ends after SESSION_GAP_MS (30 min) with YouTube not on screen
//     (noticed by the next heartbeat, or by the scheduled end if YouTube
//     isn't opened again);
//   - an ended session is sent to the server (POST /session) and, if it was
//     at least a minute long, the next visit asks "Was your last session
//     worth it?"; the rating is sent as an update of the same record.
// Records that can't be sent wait in an outbox and go with the next one.
// It also emits session_start, session_end and the rating events.
//
// Privacy: counts, durations and ratings only. The user ID is random, made
// on install, and nothing here is tied to the invite token.

import type { WorthwhileEvent } from '../contracts/events';
import { ratingEvent } from './events';
import type { Storage } from './interfaces';
import type { Settings } from './settings';

export const SESSION_GAP_MS = 30 * 60 * 1000;
const HEARTBEAT_CAP_S = 20; // at most this much on-screen time per heartbeat (they come every 15 s)
const MIN_RATED_SECONDS = 60; // shorter sessions aren't worth asking about
const RATING_EXPIRES_MS = 48 * 60 * 60 * 1000;
export const FATIGUE_MINUTES = 25;
const MAX_OUTBOX = 50;
export const SESSION_ALARM = 'session-end';
const COUNT_KINDS = ['shown', 'hidden', 'shortsSeen', 'shortsRemoved', 'corrections'] as const;
type CountKind = (typeof COUNT_KINDS)[number];

interface Session extends Record<CountKind, number> {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  activeSeconds: number;
  filterOn: boolean;
  fatigueOffered: boolean;
}

/** What POST /session takes (worker/src/sessions.js). */
export interface SessionRecord {
  session_id: string;
  user_id: string;
  started_at: number;
  duration_s: number;
  filter_on: 0 | 1;
  items_shown: number;
  items_hidden: number;
  shorts_seen: number;
  shorts_removed: number;
  corrections: number;
  rating: number | null;
}

interface EndedSession extends SessionRecord {
  endedAt: number;
  asked: boolean;
}

// Stored in local storage:
//   userId:        random UUID, made once
//   session:       the current session
//   endedSession:  the last ended session's record, until it's rated or skipped
//   sessionOutbox: records the server hasn't accepted yet
const SESSION_DEFAULTS = {
  userId: '',
  session: null as Session | null,
  endedSession: null as EndedSession | null,
  sessionOutbox: [] as SessionRecord[],
};

export interface SessionDeps {
  local: Storage;
  loadSettings: () => Promise<Settings>;
  /** POST /session { sessions }: the server's reply, or { error }. */
  postSessions: (sessions: SessionRecord[]) => Promise<any>;
  /** Arrange for onSessionAlarm() to run at this time (Chrome: chrome.alarms). */
  scheduleEnd: (when: number) => void;
  emit?: (event: WorthwhileEvent) => void;
  now?: () => number;
  uuid?: () => string;
}

export interface ActivityReply {
  sessionMinutes?: number;
  askRating?: { sessionId: string; minutes: number };
  offerFilter?: 'time';
}

export function createSessionTracker(deps: SessionDeps) {
  const now = deps.now || (() => Date.now());
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const emit = deps.emit || (() => {});
  const load = () => deps.local.get({ ...SESSION_DEFAULTS });

  // A heartbeat: { active, counts }. active: YouTube is on screen right now.
  async function onActivity({ active, counts }: { active: boolean; counts?: Record<string, unknown> }): Promise<ActivityReply> {
    const time = now();
    const [settings, stored] = await Promise.all([deps.loadSettings(), load()]);
    let { session, endedSession } = stored;

    if (session && time - session.lastActiveAt > SESSION_GAP_MS) {
      endedSession = await endSession(session);
      session = null;
    }
    if (!session) {
      if (!active) return {};
      session = newSession(time, settings.enabled);
    }
    if (active) {
      session.activeSeconds += Math.min((time - session.lastActiveAt) / 1000, HEARTBEAT_CAP_S);
      session.lastActiveAt = time;
    }
    for (const kind of COUNT_KINDS) session[kind] += Math.max(0, Math.min(Number(counts?.[kind]) || 0, 10000));
    if (!settings.enabled) session.filterOn = false;

    const reply: ActivityReply = { sessionMinutes: Math.floor(session.activeSeconds / 60) };
    // Fatigue: a long session with the filter off gets one offer to switch it on.
    if (!settings.enabled && settings.token && !session.fatigueOffered && reply.sessionMinutes! >= FATIGUE_MINUTES) {
      session.fatigueOffered = true;
      reply.offerFilter = 'time';
    }
    // The last session, asked about once, on the first visit after it ended.
    if (active && endedSession && !endedSession.asked) {
      if (time - endedSession.endedAt < RATING_EXPIRES_MS) {
        reply.askRating = { sessionId: endedSession.session_id, minutes: Math.max(1, Math.round(endedSession.duration_s / 60)) };
      }
      endedSession.asked = true;
    }
    await deps.local.set({ session, endedSession });
    deps.scheduleEnd(session.lastActiveAt + SESSION_GAP_MS + 1000);
    return reply;
  }

  // Fast Shorts swiping noticed: one offer per session, filter off only.
  async function onFatigue(): Promise<{ offer: boolean }> {
    const [settings, { session }] = await Promise.all([deps.loadSettings(), load()]);
    if (settings.enabled || !settings.token || !session || session.fatigueOffered) return { offer: false };
    await deps.local.set({ session: { ...session, fatigueOffered: true } });
    return { offer: true };
  }

  // The user's answer: rating 1-5, or null for "Skip".
  async function onRate({ sessionId, rating }: { sessionId: string; rating: number | null }): Promise<{ ok: boolean }> {
    const { endedSession } = await load();
    if (!endedSession || endedSession.session_id !== sessionId) return { ok: false };
    await deps.local.set({ endedSession: null });
    if (!(Number.isInteger(rating) && rating! >= 1 && rating! <= 5)) return { ok: true }; // skipped: the record was already sent
    const { endedAt, asked, ...record } = endedSession;
    emit(ratingEvent(sessionId, rating!, now()));
    await sendSessions([{ ...record, rating }]);
    return { ok: true };
  }

  // Runs 30 min after the last heartbeat: end the session even if YouTube
  // isn't opened again.
  async function onSessionAlarm(): Promise<void> {
    const { session } = await load();
    if (!session || now() - session.lastActiveAt < SESSION_GAP_MS) return;
    const endedSession = await endSession(session);
    await deps.local.set({ session: null, endedSession });
  }

  function newSession(time: number, filterOn: boolean): Session {
    const session: Session = {
      id: uuid(),
      startedAt: time,
      lastActiveAt: time,
      activeSeconds: 0,
      filterOn,
      shown: 0,
      hidden: 0,
      shortsSeen: 0,
      shortsRemoved: 0,
      corrections: 0,
      fatigueOffered: false,
    };
    emit({ type: 'session_start', sessionId: session.id, at: time });
    return session;
  }

  // Sends the ended session and returns what to ask about next time (or null).
  async function endSession(session: Session): Promise<EndedSession | null> {
    const record: SessionRecord = {
      session_id: session.id,
      user_id: await userId(),
      started_at: Math.floor(session.startedAt / 60000) * 60, // to the minute
      duration_s: Math.round(session.activeSeconds),
      filter_on: session.filterOn ? 1 : 0,
      items_shown: session.shown,
      items_hidden: session.hidden,
      shorts_seen: session.shortsSeen,
      shorts_removed: session.shortsRemoved,
      corrections: session.corrections,
      rating: null,
    };
    emit({ type: 'session_end', sessionId: session.id, at: now(), durationS: record.duration_s });
    if (record.duration_s === 0 && COUNT_KINDS.every((k) => session[k] === 0)) return null; // nothing happened
    await sendSessions([record]);
    return record.duration_s >= MIN_RATED_SECONDS ? { ...record, endedAt: now(), asked: false } : null;
  }

  async function userId(): Promise<string> {
    const { userId: id } = await load();
    if (id) return id;
    const fresh = uuid();
    await deps.local.set({ userId: fresh });
    return fresh;
  }

  // Sends these records plus anything waiting in the outbox. Whatever the
  // server doesn't accept waits for next time (newest kept).
  async function sendSessions(records: SessionRecord[]): Promise<void> {
    const { sessionOutbox } = await load();
    // A rating update replaces the same session's unsent record.
    const pending = [...sessionOutbox.filter((r) => !records.some((n) => n.session_id === r.session_id)), ...records].slice(-MAX_OUTBOX);
    let sent = 0;
    for (let i = 0; i < pending.length; i += 20) {
      const reply = await deps.postSessions(pending.slice(i, i + 20));
      if (reply?.error) break;
      sent = i + 20;
    }
    await deps.local.set({ sessionOutbox: pending.slice(sent) });
  }

  return { onActivity, onFatigue, onRate, onSessionAlarm };
}
