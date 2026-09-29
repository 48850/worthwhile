// sites/youtube-desktop/behaviour.ts
//
// The behaviour layer on YouTube pages (M4). Sessions themselves are kept
// by the host (core/session.ts); this file:
//   - sends a heartbeat every HEARTBEAT_MS while YouTube is on screen,
//     carrying the counts collected since the last one (core/counts.ts),
//     and one more when the page is hidden;
//   - shows what the reply asks for: the regret rating ("Was your last
//     session worth it?") on the first visit after 30+ minutes away, and
//     the fatigue offer (a long session with the filter off);
//   - offerFilter(): shorts.ts calls it after 5 Shorts in a row swiped
//     away within 3 seconds each.
// Everything is a small card in the top-right corner, built with
// textContent only. It never blocks the page.

import { takeCounts } from '../../core/counts';
import type { ActivityReply } from '../../core/session';
import { el } from './dom';
import type { PageEnv } from './env';

const HEARTBEAT_MS = 15000;

export function startBehaviour(env: PageEnv) {
  // Offers to switch the filter on, if the host says to (filter off,
  // invite token set, not offered yet this session).
  async function offerFilter(reason: string): Promise<void> {
    try {
      const reply = await env.messaging.send<{ offer?: boolean }>({ type: 'fatigue', reason });
      if (reply?.offer) showFilterOffer(reason);
    } catch {
      // extension reloaded: nothing to offer
    }
  }

  function showFilterOffer(reason: string): void {
    const card = behaviourCard();
    if (!card) return;
    const why =
      reason === 'shorts'
        ? "That's 5 Shorts in a row you swiped away within 3 seconds."
        : "You've been on YouTube for 25 minutes with Worthwhile's filter off.";
    const on = el('button', { className: 'primary', text: 'Switch it on' });
    const later = el('button', { text: 'Not now' });
    on.type = later.type = 'button';
    on.addEventListener('click', async () => {
      await env.stores.settingsStore.set({ enabled: true }); // the host starts the 7-day lock
      card.replaceChildren(el('p', { text: 'Filter on. It stays on for 7 days.' }));
      setTimeout(() => card.remove(), 4000);
    });
    later.addEventListener('click', () => card.remove());
    const buttons = el('div', { className: 'ww-behaviour-buttons' });
    buttons.append(on, later);
    card.append(el('p', { className: 'ww-behaviour-title', text: why }), el('p', { text: "Switch Worthwhile's filter on?" }), buttons);
  }

  // { sessionId, minutes }: the session that just ended.
  function askRating({ sessionId, minutes }: { sessionId: string; minutes: number }): void {
    const card = behaviourCard();
    if (!card) return;
    const send = async (rating: number | null) => {
      try {
        await env.messaging.send({ type: 'rate', sessionId, rating });
      } catch {
        // extension reloaded: the unrated record was already sent
      }
    };
    const scale = el('div', { className: 'ww-behaviour-buttons ww-behaviour-scale' });
    for (let n = 1; n <= 5; n++) {
      const button = el('button', { text: String(n) });
      button.type = 'button';
      button.title = n === 1 ? '1: not at all' : n === 5 ? '5: completely' : String(n);
      button.addEventListener('click', () => {
        send(n);
        card.replaceChildren(el('p', { text: 'Thanks.' }));
        setTimeout(() => card.remove(), 1500);
      });
      scale.append(button);
    }
    const skip = el('button', { className: 'ww-behaviour-skip', text: 'Skip' });
    skip.type = 'button';
    skip.addEventListener('click', () => {
      send(null);
      card.remove();
    });
    card.append(
      el('p', { className: 'ww-behaviour-title', text: 'Was your last YouTube session worth it?' }),
      el('p', { text: `${minutes} minute${minutes === 1 ? '' : 's'}. 1 = not at all, 5 = completely.` }),
      scale,
      skip,
    );
  }

  // An empty card, or null if one is already showing (one thing at a time).
  function behaviourCard(): HTMLElement | null {
    if (document.getElementById('ww-behaviour')) return null;
    const card = el('div', { id: 'ww-behaviour' });
    card.setAttribute('role', 'dialog');
    document.documentElement.appendChild(card);
    return card;
  }

  async function beat(): Promise<void> {
    const active = document.visibilityState === 'visible';
    const counts = takeCounts();
    env.events.flush(); // analytics go with the heartbeat, too
    let reply: ActivityReply | undefined;
    try {
      reply = await env.messaging.send<ActivityReply>({ type: 'activity', active, counts });
    } catch {
      return; // extension reloaded: this page's script is orphaned
    }
    if (!active || !reply) return;
    if (reply.askRating) askRating(reply.askRating);
    else if (reply.offerFilter) showFilterOffer(reply.offerFilter);
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') beat();
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', beat); // coming back asks about the last session; leaving sends the counts
  beat();

  return { offerFilter };
}
