// sites/youtube-desktop/shorts-page.ts
//
// Runs in YouTube's own page context (Chrome: a "world": "MAIN" content
// script; iOS: the same world as everything else), because only there can
// it see YouTube's network responses and player. It talks to shorts.ts with
// window.postMessage:
//   1. YouTube's list of upcoming Shorts (reel_watch_sequence). When YouTube
//      fetches a new list, the list is held for up to HOLD_MS while
//      shorts.ts scores it, and the Shorts it names as clear bait are taken
//      out before YouTube gets the list. So they never appear. Everything
//      else in the list is left exactly as YouTube sent it.
//      On a full page load the first list is embedded in the page instead:
//      it's passed on (to be scored for later) but can't be changed.
//   2. The Short now playing (ID, title, channel), from YouTube's player.
// Ported unchanged from extension/shorts-main.js (the list work is now
// core/shorts-sequence.ts).
//
// No extension APIs (none are available in this world). Failure rule: if
// anything goes wrong, or shorts.ts doesn't answer in time, YouTube gets its
// original response untouched.

import { readShorts, withoutShorts } from '../../core/shorts-sequence';
import { SELECTORS, SHORTS_INITIAL_GLOBAL, SHORTS_SEQUENCE_PATH } from './selectors';

const HOLD_MS = 3500; // the longest YouTube's next list is held back; shorts.ts answers sooner
const NOW_PLAYING_TRIES_MS = [0, 300, 1000, 2500];

// The two ends of the page channel (see adapters/chrome/content.ts).
export const FROM_PAGE = 'worthwhile-main';
export const TO_PAGE = 'worthwhile-extension';

export function installShortsPage(): void {
  const originalFetch = window.fetch;

  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const request = originalFetch.apply(this, args);
    let url = '';
    try {
      const input = args[0];
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url || '';
    } catch {
      // unreadable request: not ours
    }
    if (!url.includes(SHORTS_SEQUENCE_PATH)) return request;
    return request.then(filterSequence);
  } as typeof fetch;

  // The response YouTube gets: its own, or a copy without the removed Shorts.
  async function filterSequence(response: Response): Promise<Response> {
    try {
      const data = await response.clone().json();
      const shorts = readShorts(data);
      if (!shorts.length) return response;
      const remove = await askWhichToRemove(shorts);
      // Never take out the Short on screen (the first entry is often the one just opened).
      remove.delete(/^\/shorts\/([\w-]{11})/.exec(location.pathname)?.[1] as string);
      const result = withoutShorts(data, remove);
      if (!result) return response;
      post({ type: 'shorts-removed', ids: result.removed }); // for the count
      return new Response(JSON.stringify(result.data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response; // never let our filtering break YouTube
    }
  }

  // Sends the list to shorts.ts and resolves with the Set of IDs it says to
  // remove. No answer within HOLD_MS: remove nothing.
  let lastRequestId = 0;
  const waiting = new Map<number, (ids: string[]) => void>(); // requestId -> resolve
  function askWhichToRemove(shorts: ReturnType<typeof readShorts>): Promise<Set<string>> {
    const requestId = ++lastRequestId;
    return new Promise((resolve) => {
      const done = (ids: string[]) => {
        clearTimeout(timer);
        waiting.delete(requestId);
        resolve(new Set(ids));
      };
      const timer = setTimeout(() => done([]), HOLD_MS);
      waiting.set(requestId, done);
      post({ type: 'shorts-sequence', requestId, shorts });
    });
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== TO_PAGE || data.type !== 'shorts-remove') return;
    const ids = Array.isArray(data.remove) ? data.remove.filter((id: unknown) => typeof id === 'string' && /^[\w-]{11}$/.test(id)) : [];
    waiting.get(data.requestId)?.(ids);
  });

  // On a full page load of /shorts/<id>, YouTube doesn't fetch the first
  // list: it's embedded in the page as ytInitialReelWatchSequenceResponse
  // (checked live 2026-09-26; same shape, starts with the NEXT Short). It
  // can't be held back, so it's only passed on to be scored. Read once per
  // page load: the global goes stale after in-page navigation.
  let sentInitial = false;
  function forwardInitial(): void {
    if (sentInitial || !/^\/shorts\//.test(location.pathname)) return;
    try {
      const shorts = readShorts((window as any)[SHORTS_INITIAL_GLOBAL]);
      if (!shorts.length) return;
      sentInitial = true;
      post({ type: 'shorts-sequence', shorts }); // no requestId: nothing to answer
    } catch {
      // not there; the fetched lists still work
    }
  }
  document.addEventListener('DOMContentLoaded', forwardInitial);
  document.addEventListener('yt-navigate-finish', forwardInitial);

  // The Short now playing, straight from YouTube's player: its video ID and
  // title always belong together (the page's own title text can lag a Short
  // behind, which once mislabelled a whole run of collected Shorts). Sent
  // only once the player has caught up with the URL; tried a few times.
  document.addEventListener('yt-navigate-finish', () => {
    const want = /^\/shorts\/([\w-]{11})/.exec(location.pathname)?.[1];
    if (!want) return;
    let sent = false;
    for (const delay of NOW_PLAYING_TRIES_MS) {
      setTimeout(() => {
        if (sent || location.pathname !== `/shorts/${want}`) return;
        try {
          const data = (document.querySelector(SELECTORS.shortsPlayerApi) as any)?.getVideoData?.();
          if (data?.video_id !== want || !data.title) return;
          sent = true;
          post({ type: 'shorts-now', id: want, title: data.title, channel: data.author || '' });
        } catch {
          // player not ready or changed; the next try (or none) will do
        }
      }, delay);
    }
  });
}

function post(message: Record<string, unknown>): void {
  window.postMessage({ source: FROM_PAGE, ...message }, location.origin);
}
