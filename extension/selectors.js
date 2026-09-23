// extension/selectors.js
//
// Everything that depends on YouTube's page structure lives in this file:
// CSS selectors, the text formats YouTube uses, and the small functions that
// read a video card. When YouTube changes its page, this is the file to fix.
// Last checked live on 2026-09-23 (see CLAUDE.md, "YouTube DOM notes").
// scripts/export-titles.console.js uses the same selectors: keep them in step.
//
// Loaded as a plain content script (no modules), so it defines globals that
// the other content scripts use: SELECTORS, feedHidingCss, findCards,
// readCard, cardOf, readWatchChannel.

const SELECTORS = {
  // The home feed. After in-app navigation YouTube keeps previously visited
  // pages in the DOM (hidden), so only search inside this.
  homeFeed: 'ytd-browse[page-subtype="home"]',

  // Inside the feed: the grid, and the element whose children are the cards,
  // followed by YouTube's "load more" spinner as the last child.
  gridItems: 'ytd-rich-grid-renderer > #contents',
  continuation: 'ytd-continuation-item-renderer',

  // One video card. ytd-rich-item-renderer is the home grid's wrapper; inside
  // it YouTube renders the newer yt-lockup-view-model or the older
  // ytd-rich-grid-media (both seen live Sept 2026).
  card: 'ytd-rich-item-renderer, yt-lockup-view-model, ytd-rich-grid-media',

  // Link to the video; its v= parameter is the video ID. Shorts link to
  // /shorts/ so never match. Mixes and playlists are dropped in readCard.
  watchLink: 'a[href*="/watch?v="]',

  // Present inside cards that are ads, even ones that link to a video.
  ad: 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer',

  // Candidate lists are tried in order; the first usable value wins.
  // attr: read that attribute instead of the element's text. These use tag
  // names and attributes, not class names: YouTube renames classes often.
  title: [
    { css: 'h3[title]', attr: 'title' }, // lockup: heading carries the full title
    { css: 'yt-lockup-metadata-view-model a[href*="/watch?v="]' }, // lockup: title link text
    { css: 'a#video-title-link', attr: 'title' }, // older layout
    { css: '#video-title' }, // older layout, text
  ],
  channel: [
    // Lockup: the metadata is a run of text spans: channel, views, age.
    // Views and age spans carry an aria-label; the channel span doesn't.
    // (Collaborations: only the first channel is taken.)
    { css: 'yt-content-metadata-view-model a[href^="/@"]' }, // channel as a link
    { css: 'yt-content-metadata-view-model span[role="text"]:not([aria-label])' }, // channel as plain text
    { css: 'ytd-channel-name #text' }, // older layout
    { css: 'a#avatar-link', attr: 'title' }, // older layout: channel avatar
  ],
  duration: [
    { css: 'yt-thumbnail-badge-view-model badge-shape' }, // lockup thumbnail badge, e.g. "29:45"
    { css: 'ytd-thumbnail-overlay-time-status-renderer badge-shape' }, // older layout
    { css: 'ytd-thumbnail-overlay-time-status-renderer #text' }, // older layout, older markup
  ],

  // Text that is card metadata, never a channel name: viewer and view
  // counts ("12K watching", "1.2M views", "790k"), ages ("4 days ago",
  // "Streamed 22 min ago") and labels ("LIVE", "Premieres ..."). Second
  // safeguard behind the aria-label check. Assumes YouTube is in English.
  // A bare number is allowed, since channels can be called "47".
  notChannel:
    /^(?:[\d.,]+\s?[kmb]|[\d.,]+\s?[kmb]?\s+(?:watching|waiting|views?)|(?:streamed\s+)?[\d.,]+\s+\S+\s+ago|live(?: now)?|upcoming|new|(?:premieres?|premiered|scheduled for)\b.*)$/i,

  // A real duration badge ("4:05", "1:02:33"), as opposed to "LIVE" etc.
  durationFormat: /^\d{1,2}(?::\d{2}){1,2}$/,

  // Views and age ("1.2M views", "3 days ago"; live: "12K watching"). In the
  // lockup these are the metadata spans that DO carry an aria-label.
  meta: [
    'yt-content-metadata-view-model span[role="text"][aria-label]',
    '#metadata-line span.inline-metadata-item', // older layout
  ],

  // YouTube's theme and grid CSS variables. YouTube renamed its colours in
  // 2026 (the old --yt-spec-* ones are gone, which made our titles render
  // black on black). Checked live 2026-09-24. Tried in order; our own
  // fallbacks (light, or dark under darkTheme) apply if none is set.
  darkTheme: 'html[dark]',
  cssVars: {
    text: ['--yt-sys-color-baseline--text-primary', '--yt-spec-text-primary'],
    textSecondary: ['--yt-sys-color-baseline--text-secondary', '--yt-spec-text-secondary'],
    layer: ['--yt-sys-color-baseline--tonal-background', '--yt-spec-10-percent-layer'],
    columns: ['--ytd-rich-grid-items-per-row'], // set by YouTube to fit the window
    columnGap: ['--ytd-rich-grid-item-margin'],
    rowGap: ['--ytd-rich-grid-row-margin'],
    maxWidth: ['--ytd-rich-grid-content-max-width'],
  },

  // /watch page: the recommendations sidebar. Its cards are
  // yt-lockup-view-model (23 seen live), read with readCard like the feed's.
  sidebar: 'ytd-watch-next-secondary-results-renderer',

  // /watch page: which video is showing (video-id attribute), and its channel.
  watchPage: 'ytd-watch-flexy',
  watchChannelName: 'ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name #text',
  watchChannel: [
    // The description's channel card links to /channel/UC..., which gives the
    // channel ID directly, and it's there for collaborations too.
    'ytd-watch-metadata ytd-video-description-infocards-section-renderer a[href^="/channel/UC"]',
    'ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name a[href^="/@"]',
    'ytd-watch-metadata ytd-video-description-infocards-section-renderer a#header[href^="/@"]',
  ],

  // /shorts page. There is one player element, reused as you swipe; the
  // URL (/shorts/<id>) and the page title change with each Short.
  shortsTitle: 'ytd-shorts yt-shorts-video-title-view-model',
  shortsChannel: 'ytd-shorts yt-reel-channel-bar-view-model a[href^="/@"]',
  shortsPlayer: 'ytd-shorts ytd-reel-video-renderer', // the "Worthwhile: bait" label is placed over this

  // A card's ⋮ menu button, and the items of the menu it opens. Each item
  // wraps a button[role="menuitem"]. These go by YouTube's English labels.
  cardMenuButton: 'button[aria-label="More actions"], button[aria-label="Action menu"]',
  menuItem: 'ytd-popup-container yt-list-item-view-model, ytd-popup-container ytd-menu-service-item-renderer',
  menuItemButton: 'button[role="menuitem"], tp-yt-paper-item',
  notInterestedLabel: /^not interested$/i,
};

// CSS that hides YouTube's own home-feed cards while the filter is on
// (html.ww-on). It's built here so that no YouTube selector lives anywhere
// else; content.js injects it. YouTube's "load more" spinner stays in place
// but invisible, right under our grid, so scrolling to the end of our grid
// still makes YouTube load the next page. html.ww-hold removes the spinner
// entirely, which pauses loading (used while a batch is being scored).
//
// Also here: the /watch sidebar rules (cards marked data-ww-verdict by
// watch.js), and [data-ww-marking], which briefly gives a hidden home card
// a real size, off screen, while its ⋮ menu is used (notinterested.js).
function feedHidingCss() {
  const items = `${SELECTORS.homeFeed} ${SELECTORS.gridItems}`;
  return [
    `html.ww-on ${items} > :not(${SELECTORS.continuation}) { display: none !important; }`,
    `html.ww-on ${items} > ${SELECTORS.continuation} { visibility: hidden !important; }`,
    `html.ww-on.ww-hold ${items} > ${SELECTORS.continuation} { display: none !important; }`,
    `html.ww-on ${items} > [data-ww-marking] { display: block !important; position: fixed !important; left: -10000px !important; top: 0 !important; width: 360px !important; }`,
    `html.ww-on ${SELECTORS.sidebar} [data-ww-verdict="hide"] { display: none !important; }`,
    `html.ww-on ${SELECTORS.sidebar} [data-ww-verdict="pending"] { opacity: 0.35; }`,
    ...themeCss(),
  ].join('\n');
}

// Our grid's --ww-* variables, read from YouTube's own (see cssVars), so it
// matches YouTube's colours, column count and spacing. styles.css uses only
// the --ww-* names.
function themeCss() {
  const V = SELECTORS.cssVars;
  const chain = (names, fallback) => names.reduceRight((inner, name) => `var(${name}, ${inner})`, fallback);
  const colours = (text, textSecondary, layer) =>
    `--ww-text: ${chain(V.text, text)}; --ww-text-2: ${chain(V.textSecondary, textSecondary)}; --ww-layer: ${chain(V.layer, layer)};`;
  return [
    `#ww-feed { ${colours('#0f0f0f', '#606060', 'rgba(0, 0, 0, 0.05)')}` +
      ` --ww-columns: ${chain(V.columns, '4')}; --ww-column-gap: ${chain(V.columnGap, '16px')}; --ww-row-gap: ${chain(V.rowGap, '32px')};` +
      ` --ww-max-width: ${chain(V.maxWidth, 'none')}; }`,
    `${SELECTORS.darkTheme} #ww-feed { ${colours('#f1f1f1', '#aaa', 'rgba(255, 255, 255, 0.1)')} }`,
  ];
}

// The outermost card element containing el (e.g. a card's own link).
function cardOf(el) {
  let card = el.closest(SELECTORS.card);
  while (card && card.parentElement?.closest(SELECTORS.card)) card = card.parentElement.closest(SELECTORS.card);
  return card;
}

// The channel of the video on a /watch page: { id: "UC..." } or
// { handle: "@name" }, plus name when shown. null if not found.
function readWatchChannel() {
  const name = (document.querySelector(SELECTORS.watchChannelName)?.textContent || '').trim();
  for (const css of SELECTORS.watchChannel) {
    const href = document.querySelector(css)?.getAttribute('href') || '';
    const id = /^\/channel\/(UC[\w-]{22})/.exec(href)?.[1];
    if (id) return { id, name };
    const handle = /^\/(@[\w.-]+)/.exec(href)?.[1];
    if (handle) return { handle, name };
  }
  return null;
}

// Cards inside root, in page order. A wrapper and the card inside it both
// match SELECTORS.card, so only the outermost is kept.
function findCards(root) {
  return [...root.querySelectorAll(SELECTORS.card)].filter((el) => !el.parentElement.closest(SELECTORS.card));
}

// { videoId, title, channel, duration, meta, link } for a plain video card, or null
// for anything else (Shorts, ads, mixes, playlists). title is '' while
// YouTube is still filling the card in. link is YouTube's own <a> element.
function readCard(card) {
  if (card.closest('[hidden]') || card.querySelector(SELECTORS.ad)) return null;
  const link = card.querySelector(SELECTORS.watchLink);
  if (!link) return null;
  const url = new URL(link.getAttribute('href'), location.origin);
  if (url.searchParams.has('list')) return null; // mix or playlist
  const videoId = url.searchParams.get('v');
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    title: pickText(card, SELECTORS.title),
    channel: pickText(card, SELECTORS.channel, (v) => !SELECTORS.notChannel.test(v)),
    duration: pickText(card, SELECTORS.duration, (v) => SELECTORS.durationFormat.test(v)),
    meta: readMeta(card),
    link,
  };
}

// "1.2M views • 3 days ago", as the card shows it. Some layouts show a bare
// "1.9m" for views, so that gets " views" added.
function readMeta(card) {
  for (const css of SELECTORS.meta) {
    const parts = [...card.querySelectorAll(css)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (parts.length) return parts.map((p) => (/^[\d.,]+\s?[kmb]?$/i.test(p) ? `${p.toUpperCase()} views` : p)).join(' • ');
  }
  return '';
}

// First usable value from a candidate list. Checks every element a candidate
// matches (not just the first), skipping values that fail isUsable.
function pickText(card, candidates, isUsable = () => true) {
  for (const c of candidates) {
    for (const el of card.querySelectorAll(c.css)) {
      const value = ((c.attr ? el.getAttribute(c.attr) : el.textContent) || '').replace(/\s+/g, ' ').trim();
      if (value && isUsable(value)) return value;
    }
  }
  return '';
}
