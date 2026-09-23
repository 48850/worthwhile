// scripts/export-titles.console.js
//
// Paste into the DevTools console (F12 -> Console) on the YouTube home page.
// Copies every loaded video card to the clipboard as CSV rows:
//   "title","channel",
// with my_verdict left blank, ready to paste under the header of titles.csv
// or holdout.csv. Scroll down first: only cards YouTube has loaded count.
//
// The SELECTORS block is written to be copied into extension/selectors.js
// for M2. Everything after it is only for this export.
//
// Not run by Node; it's plain browser JavaScript. Safe to paste more than once.

(() => {
  // ===== SELECTORS: reuse in extension/selectors.js ========================
  const SELECTORS = {
    // The home feed. After in-app navigation YouTube keeps previously visited
    // pages in the DOM (hidden), so only search inside this.
    homeFeed: 'ytd-browse[page-subtype="home"]',

    // One video card. ytd-rich-item-renderer is the home grid's wrapper; inside
    // it YouTube renders the newer yt-lockup-view-model (seen live Sept 2026)
    // or the older ytd-rich-grid-media. All three are listed in case the
    // wrapper changes. The /watch sidebar uses bare yt-lockup-view-model cards.
    card: 'ytd-rich-item-renderer, yt-lockup-view-model, ytd-rich-grid-media',

    // Link to the video; its v= parameter is the video ID. Shorts link to
    // /shorts/ so never match. Mixes and playlists are dropped in code.
    watchLink: 'a[href*="/watch?v="]',

    // Present inside cards that are ads, even ones that link to a video.
    ad: 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer',

    // Tried in order; the first non-empty value wins.
    // attr: read that attribute instead of the element's text.
    // These use tag names and attributes, not class names: YouTube renames
    // its classes often (e.g. yt-lockup-metadata-view-model__title became
    // ytLockupMetadataViewModelTitle), while its tags change far less.
    title: [
      { css: 'h3[title]', attr: 'title' }, // lockup: heading carries the full title
      { css: 'yt-lockup-metadata-view-model a[href*="/watch?v="]' }, // lockup: title link text
      { css: 'a#video-title-link', attr: 'title' }, // older layout
      { css: '#video-title' }, // older layout, text
    ],
    channel: [
      // Lockup: the metadata is a run of text spans: channel, views, age.
      // Sometimes they share one line, so pick the span, not the line. Views
      // and age spans carry an aria-label ("1.9 million views", "4 days ago");
      // the channel span doesn't. Without :not([aria-label]), a card with no
      // channel name would silently return its view count instead.
      // (Collaborations: only the first channel is taken.)
      { css: 'yt-content-metadata-view-model a[href^="/@"]' }, // channel as a link, when YouTube links it
      { css: 'yt-content-metadata-view-model span[role="text"]:not([aria-label])' }, // channel as plain text
      { css: 'ytd-channel-name #text' }, // older layout
      { css: 'a#avatar-link', attr: 'title' }, // older layout: channel avatar
    ],
  };
  // ==========================================================================

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // First non-empty candidate, plus which selector found it (tells us which
  // layout YouTube is serving you).
  function pick(card, candidates) {
    for (const c of candidates) {
      const el = card.querySelector(c.css);
      const value = clean(el && (c.attr ? el.getAttribute(c.attr) : el.textContent));
      if (value) return { value, via: c.css };
    }
    return { value: '', via: '(nothing matched)' };
  }

  // A wrapper and the card inside it both match SELECTORS.card; keep the outer one.
  function findCards(root) {
    return [...root.querySelectorAll(SELECTORS.card)].filter((el) => !el.parentElement.closest(SELECTORS.card));
  }

  // { videoId, title, channel, titleVia, channelVia }, or null for anything
  // that isn't a plain video (Shorts, ads, mixes, playlists, placeholders).
  function readCard(card) {
    if (card.closest('[hidden]') || card.querySelector(SELECTORS.ad)) return null;
    const link = card.querySelector(SELECTORS.watchLink);
    if (!link) return null;
    const url = new URL(link.getAttribute('href'), location.origin);
    if (url.searchParams.has('list')) return null; // mix or playlist
    const videoId = url.searchParams.get('v');
    if (!videoId) return null;
    const title = pick(card, SELECTORS.title);
    const channel = pick(card, SELECTORS.channel);
    return { videoId, title: title.value, channel: channel.value, titleVia: title.via, channelVia: channel.via };
  }

  // ----- Export --------------------------------------------------------------

  const root = document.querySelector(SELECTORS.homeFeed);
  if (!root) console.warn('Worthwhile: home feed not found, searching the whole page. Are you on the YouTube home page?');
  const cards = findCards(root || document);

  const rows = [];
  const seen = new Set();
  const titleVia = {};
  const channelVia = {};
  let skipped = 0;
  let duplicates = 0;
  let noChannel = 0;
  let problem = null; // first video card missing its title or channel

  for (const card of cards) {
    const item = readCard(card);
    if (!item) {
      skipped++;
      continue;
    }
    if (seen.has(item.videoId)) {
      duplicates++;
      continue;
    }
    seen.add(item.videoId);

    if (!item.title || !item.channel) problem = problem || card;
    if (!item.title) continue; // can't label a video without a title
    if (!item.channel) noChannel++;

    rows.push(item);
    titleVia[item.titleVia] = (titleVia[item.titleVia] || 0) + 1;
    channelVia[item.channelVia] = (channelVia[item.channelVia] || 0) + 1;
  }

  // CSV: always quote, double any quotes inside. Third column (my_verdict) blank.
  const quote = (s) => '"' + s.replace(/"/g, '""') + '"';
  const csv = rows.map((r) => `${quote(r.title)},${quote(r.channel)},`).join('\n') + '\n';

  // Keep results reachable from the console after the snippet finishes.
  window.__wwCsv = csv;
  window.__wwProblem = problem;

  // copy() is a DevTools console helper; it isn't available anywhere else.
  let copied = false;
  try {
    if (rows.length && typeof copy === 'function') {
      copy(csv);
      copied = true;
    }
  } catch {
    // fall through to the manual instructions below
  }

  console.log(
    `Worthwhile: ${cards.length} cards on the page, ${rows.length} videos ` +
      `${copied ? 'COPIED to the clipboard' : 'found'}. ` +
      `Skipped ${skipped} (Shorts, ads, mixes, playlists) and ${duplicates} duplicates.`,
  );
  console.log('Title found via:', titleVia);
  console.log('Channel found via:', channelVia);
  if (rows.length) console.table(rows.slice(0, 10).map((r) => ({ title: r.title, channel: r.channel })));

  if (rows.length && !copied) console.log('Could not copy automatically. Run  copy(__wwCsv)  or copy these lines:\n' + csv);
  if (noChannel) console.warn(`${noChannel} video(s) have no channel name.`);
  if (problem) console.warn('Some cards were missing a title or channel. Run  copy(__wwProblem.outerHTML)  and send Claude that HTML.');
  if (!rows.length) {
    console.warn(
      'No videos found. In the Elements panel, right-click the outer element of one video card, ' +
        'choose Copy > Copy outerHTML, and send Claude that HTML.',
    );
  }
  return `${rows.length} rows`;
})();
