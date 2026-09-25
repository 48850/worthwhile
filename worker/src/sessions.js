// worker/src/sessions.js
//
// POST /session: saves the extension's session records (M4). Counts,
// durations and ratings only (see schema.sql). The same session can be sent
// twice, first when it ends and again once it's rated, so rows are upserted;
// a later send without a rating never erases one already saved.
//
// Privacy: logs contain counts only.

export const MAX_SESSIONS = 20; // per request

const COUNT_FIELDS = ['items_shown', 'items_hidden', 'shorts_seen', 'shorts_removed', 'corrections'];

// Returns a message describing the first problem, or null if fine.
export function checkSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > MAX_SESSIONS) {
    return `sessions must be a list of 1 to ${MAX_SESSIONS}`;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const whole = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
  for (const s of sessions) {
    if (!uuid.test(s?.session_id || '') || !uuid.test(s?.user_id || '')) return 'session_id and user_id must be UUIDs';
    if (!whole(s.started_at, 4102444800)) return 'started_at must be unix seconds';
    if (!whole(s.duration_s, 7 * 24 * 3600)) return 'duration_s must be seconds (up to a week)';
    if (s.filter_on !== 0 && s.filter_on !== 1) return 'filter_on must be 0 or 1';
    for (const f of COUNT_FIELDS) if (!whole(s[f], 100000)) return `${f} must be a count`;
    if (s.rating != null && !(Number.isInteger(s.rating) && s.rating >= 1 && s.rating <= 5)) return 'rating must be 1-5 or null';
  }
  return null;
}

export async function saveSessions(env, sessions) {
  const now = Math.floor(Date.now() / 1000);
  const rows = sessions.map((s) => ({ ...s, rating: s.rating ?? null }));
  await env.DB.prepare(
    `INSERT INTO sessions (session_id, user_id, started_at, duration_s, filter_on, items_shown, items_hidden,
                           shorts_seen, shorts_removed, corrections, rating, saved_at)
     SELECT json_extract(value, '$.session_id'), json_extract(value, '$.user_id'), json_extract(value, '$.started_at'),
            json_extract(value, '$.duration_s'), json_extract(value, '$.filter_on'), json_extract(value, '$.items_shown'),
            json_extract(value, '$.items_hidden'), json_extract(value, '$.shorts_seen'), json_extract(value, '$.shorts_removed'),
            json_extract(value, '$.corrections'), json_extract(value, '$.rating'), ?1
     FROM json_each(?2) WHERE true
     ON CONFLICT (session_id) DO UPDATE SET
       duration_s = excluded.duration_s, filter_on = excluded.filter_on, items_shown = excluded.items_shown,
       items_hidden = excluded.items_hidden, shorts_seen = excluded.shorts_seen, shorts_removed = excluded.shorts_removed,
       corrections = excluded.corrections, rating = COALESCE(excluded.rating, sessions.rating), saved_at = excluded.saved_at`,
  )
    .bind(now, JSON.stringify(rows))
    .run();
  const rated = rows.filter((r) => r.rating != null).length;
  console.log(JSON.stringify({ sessionsSaved: rows.length, rated }));
  return { saved: rows.length };
}
