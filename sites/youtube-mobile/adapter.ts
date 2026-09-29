// sites/youtube-mobile/adapter.ts
//
// The SiteAdapter for m.youtube.com (the iOS app's WKWebView). Same
// interface as sites/youtube-desktop/adapter.ts.
//
// STUBBED where it depends on the page structure (see selectors.ts): until
// those selectors are filled in, findItems() finds nothing, so nothing is
// ever hidden. Marking and observing are site-agnostic and already work.

import type { SiteAdapter } from '../../core/interfaces';
import type { FeedItem } from '../../core/types';
import { VIDEO_ID } from '../../core/util';
import { MOBILE_CSS, MOBILE_SELECTORS as S } from './selectors';

function text(card: Element, css: string | null): string {
  if (!css) return '';
  return (card.querySelector(css)?.textContent || '').replace(/\s+/g, ' ').trim();
}

export const mobileSite: SiteAdapter = {
  // TODO(home feed items): needs S.feedItem.
  findItems(root) {
    return S.feedItem ? [...root.querySelectorAll(S.feedItem)] : [];
  },

  // TODO(home feed items): needs S.itemLink, S.itemTitle, S.itemChannel.
  readItem(card) {
    if (!S.itemLink || (S.itemAd && card.querySelector(S.itemAd))) return null;
    const href = card.querySelector(S.itemLink)?.getAttribute('href') || '';
    const url = new URL(href, location.origin);
    if (url.searchParams.has('list')) return null; // mixes and playlists
    const id = url.searchParams.get('v');
    if (!id || !VIDEO_ID.test(id)) return null;
    const item: FeedItem = {
      id,
      title: text(card, S.itemTitle),
      channel: text(card, S.itemChannel),
      duration: text(card, S.itemDuration),
      isShort: false,
      url: `https://m.youtube.com/watch?v=${id}`,
    };
    return item.title ? item : null;
  },

  hideItem(card) {
    card.setAttribute('data-ww', 'hide');
    card.removeAttribute('data-ww-hallmark');
  },

  showItem(card) {
    card.setAttribute('data-ww', 'show');
    card.removeAttribute('data-ww-hallmark');
  },

  markHallmarked(card) {
    card.setAttribute('data-ww', 'show');
    card.setAttribute('data-ww-hallmark', '');
  },

  observe(root, onChange) {
    const observer = new MutationObserver(() => onChange());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
};

/** The home feed's container, once the page has one (TODO: needs S.homeFeed). */
export function findHomeFeed(): (ParentNode & Node) | null {
  return S.homeFeed ? document.querySelector(S.homeFeed) : null;
}

/** Adds the adapter's CSS to the page, once. */
export function injectMobileCss(): void {
  if (document.getElementById('ww-mobile-css')) return;
  const style = document.createElement('style');
  style.id = 'ww-mobile-css';
  style.textContent = MOBILE_CSS;
  (document.head || document.documentElement).appendChild(style);
}

// TODO(Shorts shelf): hide S.shortsShelf when settings.hideShortsShelf is on.
export function hideShortsShelf(_on: boolean): void {}

// TODO("open in app" banners): hide S.openInAppBanner (only that; never ads or branding).
export function hideOpenInAppBanners(): void {}

// TODO(Shorts player): remove bait from the upcoming Shorts list, like
// sites/youtube-desktop/shorts-page.ts, once the mobile endpoint and player
// are known.
export function installMobileShorts(): void {}
