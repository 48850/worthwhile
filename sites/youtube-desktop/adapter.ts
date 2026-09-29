// sites/youtube-desktop/adapter.ts
//
// The SiteAdapter for youtube.com's home grid. Cards are marked with
// data-ww, and the CSS from feedHidingCss() does the rest:
//   (no mark) waiting for its verdict: invisible, keeping its slot
//   "show"    visible, as YouTube placed it
//   "hide"    removed; later cards move up into its slot
// A hallmarked card is shown and also gets data-ww-hallmark (no style of its
// own yet, so it looks like any other shown card).

import type { SiteAdapter } from '../../core/interfaces';
import type { FeedItem } from '../../core/types';
import { readCard, SELECTORS } from './selectors';

/** A home-grid item, plus what the desktop UI shows from the card. */
export interface DesktopItem extends FeedItem {
  meta: string;
  link: Element;
}

function mark(card: Element, state: 'show' | 'hide', hallmark = false): void {
  if (card.getAttribute('data-ww') !== state) card.setAttribute('data-ww', state);
  if (hallmark) card.setAttribute('data-ww-hallmark', '');
  else card.removeAttribute('data-ww-hallmark');
}

export const desktopHome: SiteAdapter<DesktopItem> = {
  findItems: (root) => [...root.querySelectorAll(`:scope > ${SELECTORS.gridCard}`)],

  readItem(card) {
    const c = readCard(card);
    if (!c) return null;
    return {
      id: c.videoId,
      title: c.title,
      channel: c.channel,
      duration: c.duration,
      isShort: false, // Shorts link to /shorts/, which readCard never matches
      url: `https://www.youtube.com/watch?v=${c.videoId}`,
      meta: c.meta,
      link: c.link,
    };
  },

  hideItem: (card) => mark(card, 'hide'),
  showItem: (card) => mark(card, 'show'),
  markHallmarked: (card) => mark(card, 'show', true),

  observe(root, onChange) {
    // subtree: YouTube adds a card element first and fills it in afterwards.
    const observer = new MutationObserver(() => onChange());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
};
