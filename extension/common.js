// extension/common.js
//
// Small helpers shared by the content scripts: content.js (home feed),
// watch.js (/watch sidebar) and shorts.js (/shorts). Content scripts of one
// extension share their globals, so everything here is prefixed ww.

// Asks background.js to score items: { results } or { error }.
async function wwScore(items) {
  try {
    return await chrome.runtime.sendMessage({ type: 'score', items });
  } catch {
    return { error: 'extension-reloaded' }; // this page's script outlived an extension update
  }
}

// Asks background.js to score Shorts by video ID (up to 20):
// { results: { id: { verdict, scores } } } or { error }.
async function wwScoreShorts(ids) {
  try {
    return await chrome.runtime.sendMessage({ type: 'scoreShorts', ids });
  } catch {
    return { error: 'extension-reloaded' };
  }
}

// Asks background.js for approved videos from sourcing: { items } or { error }.
async function wwSource() {
  try {
    return await chrome.runtime.sendMessage({ type: 'source' });
  } catch {
    return { error: 'extension-reloaded' };
  }
}

// Counts for the session record (M4), sent with behaviour.js's heartbeat.
// Each (kind, id) is counted once per page, so recycled cards aren't counted
// twice. Kinds: shown, hidden (home feed and sidebar), shortsSeen,
// shortsRemoved, corrections.
const wwCounts = { shown: 0, hidden: 0, shortsSeen: 0, shortsRemoved: 0, corrections: 0 };
const wwCounted = new Set();
function wwTally(kind, id) {
  const key = `${kind}:${id}`;
  if (wwCounted.has(key)) return;
  wwCounted.add(key);
  wwCounts[kind]++;
}

function wwIsActive(settings) {
  return settings.enabled && Boolean(settings.token);
}

// Set by content.js when a feed tile is clicked, so watch.js can record the
// channel once the video's page has loaded. { videoId, channel, at }
const wwOpened = { pending: null };

// Element builder. Always textContent, never innerHTML: titles come from
// YouTube, and YouTube's page blocks innerHTML anyway.
function wwEl(tag, { id, className, text } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Resolves with find()'s first truthy result, or null after timeoutMs.
function wwWaitFor(find, timeoutMs, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const found = find();
      if (found || Date.now() - start > timeoutMs) resolve(found || null);
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function wwSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1234567 -> "1.2M views", like YouTube. '' if unknown.
function wwViews(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || count == null) return '';
  if (n < 1000) return `${n} view${n === 1 ? '' : 's'}`;
  const [value, unit] = n < 1e6 ? [n / 1e3, 'K'] : n < 1e9 ? [n / 1e6, 'M'] : [n / 1e9, 'B'];
  return `${value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)}${unit} views`;
}

// ISO date -> "3 days ago", like YouTube. '' if unknown.
function wwAgo(iso) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
