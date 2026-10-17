// sites/youtube-desktop/shorts.ts
//
// /shorts pages. Three jobs:
//
// 1. Remove clear bait before it appears ("Remove clear bait from Shorts",
//    on by default). When YouTube fetches its next list of upcoming Shorts,
//    shorts-page.ts holds it back briefly and asks which to take out. The
//    list is scored (/score-shorts: text plus thumbnail) and every Short
//    with a bait score of at least shortsRemoveLevel is named. YouTube then
//    gets the list without them, so they never show. Nothing is clicked on
//    the user's account.
//    Failure rule: whatever isn't scored within ANSWER_WITHIN_MS stays in
//    the list, and so does the Short on screen.
// 2. Label bait ("Label bait in Shorts", off by default): a small label on
//    a Short that fails the filter but is still in the list.
// 3. Collect Shorts (testing): records each Short swiped to (ID, title,
//    channel) on this device, with whether YouTube's list had named it, how
//    many seconds before, and whether its verdict was ready in time. The
//    options page copies them as CSV. Works with the filter on or off.
// Ported unchanged from extension/shorts.js; Shorts shown and removed are
// also emitted as events.

import { tally } from '../../core/counts';
import { shouldRemoveShort } from '../../core/decide';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { sleep, VIDEO_ID, waitFor } from '../../core/util';
import { el } from './dom';
import type { PageEnv } from './env';
import { SELECTORS } from './selectors';

const ANSWER_WITHIN_MS = 3000; // shorts-page.ts gives up at 3.5 s and removes nothing
const SCORE_BATCH = 20; // the Worker's limit per /score-shorts request
const MAX_COLLECTED = 500;
// Fatigue (M4): Shorts swiped away within FAST_SKIP_MS, in a row. At
// FAST_SKIPS, behaviour.ts may offer to switch the filter on.
const FAST_SKIP_MS = 3000;
const FAST_SKIPS = 5;

export function startShorts(env: PageEnv, offerFilter: (reason: string) => void): void {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const scores = new Map<string, { verdict: string; bait: number }>(); // id -> { verdict, bait }
  const inFlight = new Map<string, Promise<void>>(); // id -> Promise that settles when its batch is answered
  const firstSeenInSequence = new Map<string, number>(); // id -> ms, first time YouTube's list named it
  const upcomingDetails = new Map<string, { title: string; channel: string }>(); // when YouTube's list had them
  // The Short now playing, as YouTube's player reports it (shorts-page.ts):
  // id -> { title, channel }. The only title source trusted for a Short.
  const nowPlaying = new Map<string, { title: string; channel: string }>();
  let currentId: string | null = null; // the Short on screen; null when not on a Short
  let arrivedAt = 0;
  let fastSkips = 0;

  // ---------------------------------------------------------------------------
  // Messages from shorts-page.ts (page messages are untrusted: check shapes)
  // ---------------------------------------------------------------------------

  env.pageChannel.onMessage((data) => {
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

    if (data.type === 'shorts-now' && typeof data.id === 'string' && VIDEO_ID.test(data.id) && text(data.title, 300)) {
      nowPlaying.set(data.id, { title: text(data.title, 300), channel: text(data.channel, 150) });
      if (nowPlaying.size > 200) nowPlaying.delete(nowPlaying.keys().next().value!); // oldest out
    } else if (data.type === 'shorts-removed' && Array.isArray(data.ids)) {
      // What shorts-page.ts actually took out (it keeps a list that would get too short).
      const removed: string[] = data.ids.filter((id: unknown) => typeof id === 'string' && scores.has(id));
      if (removed.length) env.stores.rememberRemovedShorts(removed.map((id) => ({ id, bait: scores.get(id)!.bait })));
      removed.forEach((id) => {
        tally('shortsRemoved', id);
        env.events.itemDecided(id, true, { action: 'hide', reason: 'bait-level' });
      });
    } else if (data.type === 'shorts-sequence' && Array.isArray(data.shorts)) {
      const now = Date.now();
      const ids: string[] = [];
      for (const s of data.shorts) {
        if (typeof s?.id !== 'string' || !VIDEO_ID.test(s.id)) continue;
        ids.push(s.id);
        if (!firstSeenInSequence.has(s.id)) firstSeenInSequence.set(s.id, now);
        if (text(s.title, 300)) upcomingDetails.set(s.id, { title: text(s.title, 300), channel: text(s.channel, 150) });
      }
      if (data.requestId != null) answer(data.requestId, ids);
      else requestScores(ids); // the embedded first list: score it for later, nothing to answer
    }
  });

  // Tells shorts-page.ts which of these Shorts to take out of YouTube's list.
  // Answers at once (removing nothing) when removal is off, so YouTube is
  // never held back for nothing.
  async function answer(requestId: unknown, ids: string[]): Promise<void> {
    let remove: string[] = [];
    if (removalOn()) {
      const scored = Promise.all(requestScores(ids));
      await Promise.race([scored, sleep(ANSWER_WITHIN_MS)]);
      remove = ids.filter((id) => shouldRemoveShort(scores.get(id), settings.shortsRemoveLevel, id === currentId));
    } else {
      requestScores(ids); // still score them, for the label
    }
    env.pageChannel.post({ type: 'shorts-remove', requestId, remove });
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  env.stores.loadSettings().then((stored) => {
    settings = stored;
    arrive();
  });
  document.addEventListener('yt-navigate-finish', () => arrive());
  env.stores.localStore.onChanged?.((changes) => {
    if (changes.corrections) scores.clear(); // corrections are part of the prompt
  });
  env.stores.settingsStore.onChanged?.((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        (settings as any)[key] = change.newValue === undefined ? (DEFAULT_SETTINGS as any)[key] : change.newValue;
      }
    }
    if (['rubric', 'interests', 'rule', 'strictness'].some((key) => key in changes)) scores.clear();
    if (currentId) {
      removeLabel();
      maybeLabel(currentId);
    }
  });

  function isActive(): boolean {
    return settings.enabled && Boolean(settings.token);
  }

  function removalOn(): boolean {
    return isActive() && settings.shortsRemove;
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  // Asks the Worker for any of these not already scored or on their way.
  // Returns one promise per batch still in flight for these IDs (they never
  // reject: a failed batch just leaves its Shorts unscored).
  function requestScores(ids: string[]): Promise<void>[] {
    if (!isActive() || !(settings.shortsRemove || settings.shortsLabels)) return [];
    const unique = [...new Set(ids)];
    const fresh = unique.filter((id) => !scores.has(id) && !inFlight.has(id));
    for (let i = 0; i < fresh.length; i += SCORE_BATCH) {
      const batch = fresh.slice(i, i + SCORE_BATCH);
      const done = env.classifier.classifyShorts(batch).then((result) => {
        for (const id of batch) {
          const classification = result.decisions?.[id];
          if (classification?.scores) scores.set(id, { verdict: classification.verdict, bait: classification.scores.bait });
          inFlight.delete(id); // unscored ones (error, or YouTube doesn't know them) may be asked again
        }
        if (currentId && batch.includes(currentId)) maybeLabel(currentId);
      });
      batch.forEach((id) => inFlight.set(id, done));
    }
    return [...new Set(unique.map((id) => inFlight.get(id)).filter((p): p is Promise<void> => Boolean(p)))];
  }

  // ---------------------------------------------------------------------------
  // A Short comes up
  // ---------------------------------------------------------------------------

  function arrive(): void {
    const id = /^\/shorts\/([\w-]{11})/.exec(location.pathname)?.[1] || null;
    if (id === currentId) return;
    const now = Date.now();
    fastSkips = currentId && id && now - arrivedAt < FAST_SKIP_MS ? fastSkips + 1 : 0;
    if (fastSkips >= FAST_SKIPS) {
      fastSkips = 0;
      offerFilter('shorts');
    }
    arrivedAt = now;
    currentId = id;
    removeLabel();
    if (!id) return;
    tally('shortsSeen', id);
    env.events.itemDecided(id, true, { action: 'show', reason: scores.has(id) ? 'scored' : 'unscored' });
    const verdictReady = scores.has(id);
    requestScores([id]); // not in YouTube's list in time: score it now (for the label)
    maybeLabel(id);
    if (settings.collectShorts) collectArrival(id, { ...checkQueue(id), verdictReady });
  }

  // ---------------------------------------------------------------------------
  // Label (when on): "Worthwhile: bait" on a Short that fails the filter
  // ---------------------------------------------------------------------------

  function maybeLabel(id: string): void {
    if (id !== currentId || !settings.shortsLabels || !isActive()) return;
    if (scores.get(id)?.verdict !== 'hide' || document.getElementById('ww-shorts-label')) return;
    const rect = document.querySelector(SELECTORS.shortsPlayer)?.getBoundingClientRect();
    const label = el('div', { id: 'ww-shorts-label', text: 'Worthwhile: bait' });
    label.style.top = `${Math.max(rect && rect.height ? rect.top + 12 : 72, 64)}px`;
    label.style.left = `${rect && rect.width ? rect.left + 12 : 24}px`;
    document.documentElement.appendChild(label);
  }

  function removeLabel(): void {
    document.getElementById('ww-shorts-label')?.remove();
  }

  // ---------------------------------------------------------------------------
  // Collect Shorts (testing)
  // ---------------------------------------------------------------------------

  // { queued: 'yes' | 'no' | 'unknown', lead }: whether YouTube's list had
  // named this Short before it came up, and how many seconds before.
  // 'unknown' until the first list has arrived.
  function checkQueue(id: string): { queued: 'yes' | 'no' | 'unknown'; lead: number | null } {
    const seen = firstSeenInSequence.get(id);
    const now = Date.now();
    const lead = seen == null || now - seen < 200 ? null : Math.round((now - seen) / 100) / 10; // < 0.2 s: only as it came up
    const queued = firstSeenInSequence.size === 0 ? 'unknown' : lead != null ? 'yes' : 'no';
    return { queued, lead };
  }

  // Title and channel come from YouTube's player, which reports them with
  // the video ID. No report within 4 s: leave this Short out.
  async function collectArrival(id: string, arrival: { queued: 'yes' | 'no' | 'unknown'; lead: number | null; verdictReady: boolean }): Promise<void> {
    const playing = await waitFor(() => nowPlaying.get(id), 4000);
    if (!playing) return;
    const { collectedShorts } = await env.stores.loadLocal();
    if (collectedShorts.some((s) => s.id === id)) return;
    const entry = { id, title: playing.title, channel: playing.channel, ...arrival, at: Date.now() };
    await env.stores.localStore.set({ collectedShorts: [...collectedShorts, entry].slice(-MAX_COLLECTED) });
  }
}
