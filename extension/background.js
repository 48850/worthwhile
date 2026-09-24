// extension/background.js
//
// The only part of the extension that talks to the Worker. Content scripts
// can't make cross-origin requests themselves, and keeping the invite token
// here keeps it out of YouTube's page.

importScripts('settings.js');

// Where the Worker runs. Local development: `npm run dev` in the project root.
// After deploying, change this to your workers.dev URL, and narrow
// host_permissions in manifest.json to match.
const WORKER_URL = 'http://127.0.0.1:8787';
const TIMEOUT_MS = 30000;
const SOURCE_TIMEOUT_MS = 60000; // sourcing may fetch from YouTube and score dozens of videos

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = { score: () => scoreItems(message.items), source: sourceItems };
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler().then(sendResponse, (err) => sendResponse({ error: 'network', detail: String(err?.message || err) }));
  return true; // keeps the message channel open for the async reply
});

// Returns the Worker's reply ({ results: { videoId: { verdict, scores } } })
// or { error }. The content script shows everything on any error.
async function scoreItems(items) {
  return post('/score', { items }, TIMEOUT_MS);
}

// Approved videos from the user's interests and the channels they opened
// from the grid (remembered on this device): { items } or { error }.
async function sourceItems() {
  const { openedChannels } = await loadLocal();
  const channels = openedChannels.slice(0, 20).map((c) => (c.id ? { id: c.id } : { handle: c.handle }));
  return post('/source', { channels }, SOURCE_TIMEOUT_MS);
}

async function post(path, body, timeoutMs) {
  const [s, { corrections }] = await Promise.all([loadSettings(), loadLocal()]);
  if (!s.token) return { error: 'no-token' };
  // The user's newest corrections go along as labelled examples. They're
  // part of the prompt, so a new correction re-scores (new cache key).
  const profile = { rubric: s.rubric, interests: s.interests, rule: s.rule, strictness: s.strictness, examples: correctionExamples(corrections) };
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ profile, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401) return { error: 'bad-token' };
  if (!response.ok) return { error: 'server', detail: `HTTP ${response.status}` };
  return response.json();
}

// Toolbar badge shows "OFF" while the filter is switched off.
async function updateBadge() {
  const { enabled } = await loadSettings();
  await chrome.action.setBadgeBackgroundColor({ color: '#777' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  updateBadge();
  // First install: open settings so the tester can paste their invite token.
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) updateBadge();
});
