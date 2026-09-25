// extension/sessions.js
//
// The behaviour layer's bookkeeping (M4), run by background.js. Content
// scripts (behaviour.js) send a heartbeat every 15 s while YouTube is on
// screen, carrying counts since the last one. From those this keeps the
// current session:
//   - it ends after SESSION_GAP_MS (30 min) with YouTube not on screen
//     (noticed by the next heartbeat, or by an alarm if YouTube isn't
//     opened again);
//   - an ended session is sent to the Worker (POST /session) and, if it was
//     at least a minute long, the next visit asks "Was your last session
//     worth it?"; the rating is sent as an update of the same record.
// Records that can't be sent wait in an outbox and go with the next one.
//
// Privacy: counts, durations and ratings only. The user ID is random, made
// on install, and nothing here is tied to the invite token.

const SESSION_GAP_MS = 30 * 60 * 1000;
const HEARTBEAT_CAP_S = 20; // at most this much on-screen time per heartbeat (they come every 15 s)
const MIN_RATED_SECONDS = 60; // shorter sessions aren't worth asking about
const RATING_EXPIRES_MS = 48 * 60 * 60 * 1000;
const FATIGUE_MINUTES = 25;
const MAX_OUTBOX = 50;
const SESSION_ALARM = 'session-end';
const COUNT_KINDS = ['shown', 'hidden', 'shortsSeen', 'shortsRemoved', 'corrections'];

// Stored in chrome.storage.local:
//   userId:        random UUID, made once
//   session:       { id, startedAt, lastActiveAt (ms), activeSeconds, filterOn,
//                    shown, hidden, shortsSeen, shortsRemoved, corrections, fatigueOffered }
//   endedSession:  the last ended session's record, until it's rated or skipped
//                  (plus endedAt and asked)
//   sessionOutbox: records the Worker hasn't accepted yet
const SESSION_DEFAULTS = { userId: '', session: null, endedSession: null, sessionOutbox: [] };

// A heartbeat: { active, counts }. active: YouTube is on screen right now.
// Replies { sessionMinutes, askRating?, offerFilter? } for behaviour.js.
async function onActivity({ active, counts }) {
  const now = Date.now();
  const [settings, stored] = await Promise.all([loadSettings(), chrome.storage.local.get(SESSION_DEFAULTS)]);
  let { session, endedSession } = stored;

  if (session && now - session.lastActiveAt > SESSION_GAP_MS) {
    endedSession = await endSession(session);
    session = null;
  }
  if (!session) {
    if (!active) return {};
    session = newSession(now, settings.enabled);
  }
  if (active) {
    session.activeSeconds += Math.min((now - session.lastActiveAt) / 1000, HEARTBEAT_CAP_S);
    session.lastActiveAt = now;
  }
  for (const kind of COUNT_KINDS) session[kind] += Math.max(0, Math.min(Number(counts?.[kind]) || 0, 10000));
  if (!settings.enabled) session.filterOn = false;

  const reply = { sessionMinutes: Math.floor(session.activeSeconds / 60) };
  // Fatigue: a long session with the filter off gets one offer to switch it on.
  if (!settings.enabled && settings.token && !session.fatigueOffered && reply.sessionMinutes >= FATIGUE_MINUTES) {
    session.fatigueOffered = true;
    reply.offerFilter = 'time';
  }
  // The last session, asked about once, on the first visit after it ended.
  if (active && endedSession && !endedSession.asked) {
    if (now - endedSession.endedAt < RATING_EXPIRES_MS) {
      reply.askRating = { sessionId: endedSession.session_id, minutes: Math.max(1, Math.round(endedSession.duration_s / 60)) };
    }
    endedSession.asked = true;
  }
  await chrome.storage.local.set({ session, endedSession });
  chrome.alarms.create(SESSION_ALARM, { when: session.lastActiveAt + SESSION_GAP_MS + 1000 });
  return reply;
}

// Fast Shorts swiping noticed by shorts.js: one offer per session, filter off only.
async function onFatigue() {
  const [settings, { session }] = await Promise.all([loadSettings(), chrome.storage.local.get(SESSION_DEFAULTS)]);
  if (settings.enabled || !settings.token || !session || session.fatigueOffered) return { offer: false };
  await chrome.storage.local.set({ session: { ...session, fatigueOffered: true } });
  return { offer: true };
}

// The user's answer: rating 1-5, or null for "Skip".
async function onRate({ sessionId, rating }) {
  const { endedSession } = await chrome.storage.local.get(SESSION_DEFAULTS);
  if (!endedSession || endedSession.session_id !== sessionId) return { ok: false };
  await chrome.storage.local.set({ endedSession: null });
  if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return { ok: true }; // skipped: the record was already sent
  const { endedAt, asked, ...record } = endedSession;
  await sendSessions([{ ...record, rating }]);
  return { ok: true };
}

// The alarm fires 30 min after the last heartbeat: end the session even if
// YouTube isn't opened again.
async function onSessionAlarm() {
  const { session } = await chrome.storage.local.get(SESSION_DEFAULTS);
  if (!session || Date.now() - session.lastActiveAt < SESSION_GAP_MS) return;
  const endedSession = await endSession(session);
  await chrome.storage.local.set({ session: null, endedSession });
}

function newSession(now, filterOn) {
  return {
    id: crypto.randomUUID(),
    startedAt: now,
    lastActiveAt: now,
    activeSeconds: 0,
    filterOn,
    shown: 0,
    hidden: 0,
    shortsSeen: 0,
    shortsRemoved: 0,
    corrections: 0,
    fatigueOffered: false,
  };
}

// Sends the ended session and returns what to ask about next time (or null).
async function endSession(session) {
  const record = {
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
  if (record.duration_s === 0 && COUNT_KINDS.every((k) => session[k] === 0)) return null; // nothing happened
  await sendSessions([record]);
  return record.duration_s >= MIN_RATED_SECONDS ? { ...record, endedAt: Date.now(), asked: false } : null;
}

async function userId() {
  const { userId: id } = await chrome.storage.local.get(SESSION_DEFAULTS);
  if (id) return id;
  const fresh = crypto.randomUUID();
  await chrome.storage.local.set({ userId: fresh });
  return fresh;
}

// Sends these records plus anything waiting in the outbox. Whatever the
// Worker doesn't accept waits for next time (newest kept).
async function sendSessions(records) {
  const { sessionOutbox } = await chrome.storage.local.get(SESSION_DEFAULTS);
  // A rating update replaces the same session's unsent record.
  const pending = [...sessionOutbox.filter((r) => !records.some((n) => n.session_id === r.session_id)), ...records].slice(-MAX_OUTBOX);
  let sent = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const reply = await post('/session', { sessions: pending.slice(i, i + 20) }, TIMEOUT_MS, { profile: false });
    if (reply?.error) break;
    sent = i + 20;
  }
  await chrome.storage.local.set({ sessionOutbox: pending.slice(sent) });
}
