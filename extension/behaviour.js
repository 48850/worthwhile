// extension/behaviour.js
//
// The behaviour layer on YouTube pages (M4). Sessions themselves are kept
// by background.js (sessions.js); this file:
//   - sends a heartbeat every HEARTBEAT_MS while YouTube is on screen,
//     carrying the counts collected since the last one (wwCounts in
//     common.js), and one more when the page is hidden;
//   - shows what the reply asks for: the regret rating ("Was your last
//     session worth it?") on the first visit after 30+ minutes away, and
//     the fatigue offer (a long session with the filter off);
//   - wwOfferFilter(): shorts.js calls it after 5 Shorts in a row swiped
//     away within 3 seconds each.
// Everything is a small card in the top-right corner, built with
// textContent only. It never blocks the page.

// Offers to switch the filter on, if background.js says to (filter off,
// invite token set, not offered yet this session).
async function wwOfferFilter(reason) {
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'fatigue', reason });
    if (reply?.offer) wwShowFilterOffer(reason);
  } catch {
    // extension reloaded: nothing to offer
  }
}

function wwShowFilterOffer(reason) {
  const card = wwBehaviourCard();
  if (!card) return;
  const why =
    reason === 'shorts'
      ? 'That\'s 5 Shorts in a row you swiped away within 3 seconds.'
      : 'You\'ve been on YouTube for 25 minutes with Worthwhile\'s filter off.';
  const on = wwEl('button', { className: 'primary', text: 'Switch it on' });
  const later = wwEl('button', { text: 'Not now' });
  on.type = later.type = 'button';
  on.addEventListener('click', async () => {
    await chrome.storage.sync.set({ enabled: true }); // background.js starts the 7-day lock
    card.replaceChildren(wwEl('p', { text: 'Filter on. It stays on for 7 days.' }));
    setTimeout(() => card.remove(), 4000);
  });
  later.addEventListener('click', () => card.remove());
  const buttons = wwEl('div', { className: 'ww-behaviour-buttons' });
  buttons.append(on, later);
  card.append(wwEl('p', { className: 'ww-behaviour-title', text: why }), wwEl('p', { text: 'Switch Worthwhile\'s filter on?' }), buttons);
}

// { sessionId, minutes }: the session that just ended.
function wwAskRating({ sessionId, minutes }) {
  const card = wwBehaviourCard();
  if (!card) return;
  const send = async (rating) => {
    try {
      await chrome.runtime.sendMessage({ type: 'rate', sessionId, rating });
    } catch {
      // extension reloaded: the unrated record was already sent
    }
  };
  const scale = wwEl('div', { className: 'ww-behaviour-buttons ww-behaviour-scale' });
  for (let n = 1; n <= 5; n++) {
    const button = wwEl('button', { text: String(n) });
    button.type = 'button';
    button.title = n === 1 ? '1: not at all' : n === 5 ? '5: completely' : String(n);
    button.addEventListener('click', () => {
      send(n);
      card.replaceChildren(wwEl('p', { text: 'Thanks.' }));
      setTimeout(() => card.remove(), 1500);
    });
    scale.append(button);
  }
  const skip = wwEl('button', { className: 'ww-behaviour-skip', text: 'Skip' });
  skip.type = 'button';
  skip.addEventListener('click', () => {
    send(null);
    card.remove();
  });
  card.append(
    wwEl('p', { className: 'ww-behaviour-title', text: 'Was your last YouTube session worth it?' }),
    wwEl('p', { text: `${minutes} minute${minutes === 1 ? '' : 's'}. 1 = not at all, 5 = completely.` }),
    scale,
    skip,
  );
}

// An empty card, or null if one is already showing (one thing at a time).
function wwBehaviourCard() {
  if (document.getElementById('ww-behaviour')) return null;
  const card = wwEl('div', { id: 'ww-behaviour' });
  card.setAttribute('role', 'dialog');
  document.documentElement.appendChild(card);
  return card;
}

(() => {
  const HEARTBEAT_MS = 15000;

  async function beat() {
    const active = document.visibilityState === 'visible';
    const counts = { ...wwCounts };
    for (const kind of Object.keys(wwCounts)) wwCounts[kind] = 0;
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'activity', active, counts });
    } catch {
      return; // extension reloaded: this page's script is orphaned
    }
    if (!active || !reply) return;
    if (reply.askRating) wwAskRating(reply.askRating);
    else if (reply.offerFilter) wwShowFilterOffer(reply.offerFilter);
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') beat();
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', beat); // coming back asks about the last session; leaving sends the counts
  beat();
})();
