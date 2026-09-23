// extension/shorts.js
//
// /shorts pages, while the filter is on: scores each Short as it comes up
// and skips to the next one if it fails (YouTube's own "Next video" button).
// After 5 skips in a row, auto-skip pauses until a Short passes, so a feed
// of nothing but bait can't spin through Shorts (and scoring costs) forever.
//
// Failure rule: a scoring error means "show" (no skip).

(() => {
  const MAX_SKIPS_IN_A_ROW = 5;

  let settings = { ...DEFAULT_SETTINGS };
  const verdicts = new Map(); // shortId -> 'show' | 'hide'
  let lastId = null;
  let lastTitle = '';
  let skipsInARow = 0;

  loadSettings().then((stored) => {
    settings = stored;
    check();
  });
  document.addEventListener('yt-navigate-finish', () => check());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
    }
    if (['rubric', 'interests', 'strictness'].some((key) => key in changes)) verdicts.clear();
  });

  // The player's title element (empty until the Short renders), and the page
  // title ("(3) Title - YouTube"), which starts out generic on a fresh load.
  function panelTitle() {
    return (document.querySelector(SELECTORS.shortsTitle)?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function pageTitle() {
    return document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
  }

  async function check() {
    const match = /^\/shorts\/([\w-]{11})/.exec(location.pathname);
    if (!match || !wwIsActive(settings)) return;
    const id = match[1];
    if (id === lastId) return;
    lastId = id;

    // The title catches up with the new Short a moment after the URL. Only
    // trust a title that belongs to this Short: the player's title once it
    // differs from the last Short's, or the page title once it has changed
    // since this Short came up. If neither, leave the Short alone.
    const titleAtStart = pageTitle();
    const finalTitle = await wwWaitFor(() => {
      const panel = panelTitle();
      if (panel && panel !== lastTitle) return panel;
      const page = pageTitle();
      if (page && page !== lastTitle && page !== titleAtStart) return page;
      return null;
    }, 4000);
    if (!finalTitle || location.pathname !== `/shorts/${id}`) return;
    lastTitle = finalTitle;

    let verdict = verdicts.get(id);
    if (!verdict) {
      const channel = (document.querySelector(SELECTORS.shortsChannel)?.textContent || '').trim();
      const reply = await wwScore([{ id, title: finalTitle.slice(0, 300), channel }]);
      verdict = reply?.results?.[id]?.verdict === 'hide' ? 'hide' : 'show'; // errors mean "show"
      verdicts.set(id, verdict);
    }

    if (verdict === 'show') {
      skipsInARow = 0;
      return;
    }
    if (location.pathname !== `/shorts/${id}`) return; // the user already moved on
    if (skipsInARow >= MAX_SKIPS_IN_A_ROW) {
      wwToast(`Worthwhile paused auto-skip after ${MAX_SKIPS_IN_A_ROW} filtered Shorts in a row. It resumes when one passes.`, 4000);
      return;
    }
    skipsInARow++;
    wwToast('Skipped by Worthwhile');
    // Marked so M4's "Shorts skipped within 3 seconds" count can ignore our own skips.
    document.documentElement.dataset.wwAutoSkipAt = String(Date.now());
    document.querySelector(SELECTORS.shortsNext)?.click();
  }
})();
