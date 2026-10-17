// sites/youtube-mobile/selectors.ts
//
// m.youtube.com's page structure, for the iOS app's WKWebView. Same role as
// sites/youtube-desktop/selectors.ts: every m.youtube.com selector lives
// here and nowhere else.
//
// STUBBED. None of these have been checked against the real mobile site,
// and they are deliberately not guessed: a wrong selector hides the wrong
// things. To fill one in, open m.youtube.com in Safari (Develop menu > the
// iPhone simulator or a device), inspect the element, and paste its HTML
// into the conversation. While a selector is null, the adapter finds
// nothing and the filter does nothing (fail safe: YouTube as normal).

export const MOBILE_SELECTORS = {
  // TODO(home feed items): the element holding the home feed's cards, and
  // one video card inside it (probably ytm-rich-item-renderer or similar;
  // check). Readers below need the card's video link, title and channel.
  homeFeed: null as string | null,
  feedItem: null as string | null,
  itemLink: null as string | null, // a link whose href holds the video ID (/watch?v=...)
  itemTitle: null as string | null,
  itemChannel: null as string | null,
  itemDuration: null as string | null,
  itemAd: null as string | null, // marks ad cards, which are never touched

  // TODO(Shorts shelf): the shelf of Shorts in the home feed, hidden when
  // "Hide the Shorts shelf" is on.
  shortsShelf: null as string | null,

  // TODO(Shorts player): the Shorts player on /shorts/<id>, and whether the
  // mobile site fetches upcoming Shorts from the same youtubei
  // reel_watch_sequence endpoint as desktop (if so, core/shorts-sequence.ts
  // and the desktop page hook can be reused as they are).
  shortsPlayer: null as string | null,

  // TODO("open in app" banners): the banners and sheets that ask the user to
  // open the YouTube app, which make no sense inside our app. Only these:
  // never ads, and never YouTube's branding.
  openInAppBanner: null as string | null,

  // TODO: the event m.youtube.com fires after in-app navigation (desktop:
  // yt-navigate-finish). Until known, the adapter re-checks on DOM changes.
  navigateEvent: null as string | null,
};

/** CSS for the data-ww marks the adapter sets (site-agnostic). */
export const MOBILE_CSS = `
[data-ww="hide"] { display: none !important; }
`;
