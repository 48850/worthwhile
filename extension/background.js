// extension/background.js
//
// The only part of the extension that talks to the Worker. Content scripts
// can't make cross-origin requests themselves, and keeping the invite token
// here keeps it out of YouTube's page.

importScripts('settings.js');

// Where the Worker runs. Local development: `npm run dev` in /worker.
// After deploying, change this to your workers.dev URL, and narrow
// host_permissions in manifest.json to match.
const WORKER_URL = 'http://127.0.0.1:8787';
const TIMEOUT_MS = 30000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'score') return false;
  scoreItems(message.items).then(sendResponse, (err) => sendResponse({ error: 'network', detail: String(err?.message || err) }));
  return true; // keeps the message channel open for the async reply
});

// Returns the Worker's reply ({ results: { videoId: { verdict, scores } } })
// or { error }. The content script shows everything on any error.
async function scoreItems(items) {
  const s = await loadSettings();
  if (!s.token) return { error: 'no-token' };
  const response = await fetch(`${WORKER_URL}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify({
      profile: { rubric: s.rubric, interests: s.interests, strictness: s.strictness },
      items,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
