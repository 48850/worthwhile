// extension/background.js
//
// The only part of the extension that talks to the Worker. Content scripts
// can't make cross-origin requests themselves, and keeping the invite token
// here keeps it out of YouTube's page.
//
// It also tracks whether the Worker is reachable, and says so on the toolbar
// icon and in the popup ("Offline: showing everything"), so failing open is
// never silent.

importScripts('settings.js', 'sessions.js');

// Where the Worker runs: the deployed Cloudflare Worker. For local
// development, use 'http://127.0.0.1:8787' (`npm run dev` in the project root).
// host_permissions in manifest.json must match.
const WORKER_URL = 'http://127.0.0.1:8787';
const TIMEOUT_MS = 30000;
const SOURCE_TIMEOUT_MS = 60000; // sourcing may fetch from YouTube and score dozens of videos
const HEALTH_TIMEOUT_MS = 5000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    score: () => scoreItems(message.items),
    scoreShorts: () => scoreShorts(message.ids),
    source: sourceItems,
    checkServer,
    activity: () => onActivity(message), // sessions.js
    fatigue: onFatigue,
    rate: () => onRate(message),
  };
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

// Shorts by video ID (up to 20): the Worker looks up each one's details and
// thumbnail itself. Same reply shape as /score.
async function scoreShorts(ids) {
  return post('/score-shorts', { ids }, TIMEOUT_MS);
}

// Approved videos from the user's interests and the channels they opened
// (remembered on this device): { items } or { error }.
async function sourceItems() {
  const { openedChannels } = await loadLocal();
  const channels = openedChannels.slice(0, 20).map((c) => (c.id ? { id: c.id } : { handle: c.handle }));
  return post('/source', { channels }, SOURCE_TIMEOUT_MS);
}

// profile: false for requests that don't score anything (POST /session).
async function post(path, body, timeoutMs, { profile: withProfile = true } = {}) {
  const [s, { corrections }] = await Promise.all([loadSettings(), loadLocal()]);
  if (!s.token) {
    await setServerStatus('no-token');
    return { error: 'no-token' };
  }
  // The user's newest corrections go along as labelled examples. They're
  // part of the prompt, so a new correction re-scores (new cache key).
  const profile = { rubric: s.rubric, interests: s.interests, rule: s.rule, strictness: s.strictness, examples: correctionExamples(corrections) };
  let response;
  try {
    response = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify(withProfile ? { profile, ...body } : body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    await setServerStatus('offline');
    return { error: 'network', detail: String(err?.message || err) };
  }
  if (response.status === 401) {
    await setServerStatus('bad-token');
    return { error: 'bad-token' };
  }
  if (!response.ok) {
    await setServerStatus('offline');
    return { error: 'server', detail: `HTTP ${response.status}` };
  }
  await setServerStatus('ok');
  return response.json();
}

// The popup asks this each time it opens, so its status is current.
async function checkServer() {
  const { token } = await loadSettings();
  if (!token) return setServerStatus('no-token');
  try {
    const response = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const { serverStatus } = await chrome.storage.session.get({ serverStatus: 'unknown' });
    // /health doesn't check the token, so keep a known "bad-token" until a real request succeeds.
    return setServerStatus(response.ok ? (serverStatus === 'bad-token' ? 'bad-token' : 'ok') : 'offline');
  } catch {
    return setServerStatus('offline');
  }
}

// serverStatus: 'ok' | 'offline' | 'bad-token' | 'no-token' | 'unknown'.
// Kept in session storage (cleared when the browser closes).
async function setServerStatus(serverStatus) {
  await chrome.storage.session.set({ serverStatus });
  await updateBadge();
  return { serverStatus };
}

// Toolbar icon: "OFF" while switched off; "!" while it can't filter
// (offline, or the invite token is missing or rejected).
async function updateBadge() {
  const [{ enabled }, { serverStatus }] = await Promise.all([loadSettings(), chrome.storage.session.get({ serverStatus: 'unknown' })]);
  let text = '';
  let color = '#777';
  let title = 'Worthwhile';
  if (!enabled) {
    text = 'OFF';
    title = 'Worthwhile: switched off';
  } else if (serverStatus === 'offline') {
    text = '!';
    color = '#e37400';
    title = 'Worthwhile: Offline: showing everything';
  } else if (serverStatus === 'bad-token' || serverStatus === 'no-token') {
    text = '!';
    color = '#e37400';
    title = 'Worthwhile: invite token needed: showing everything';
  }
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  updateBadge();
  if (reason === 'install') {
    // Installing switches the filter on, so the commitment lock starts now.
    chrome.storage.sync.set({ lockedUntil: Date.now() + LOCK_DAYS * 24 * 60 * 60 * 1000 });
    // First install: open settings so the tester can paste their invite token.
    chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.enabled || changes.token)) updateBadge();
  // Switching the filter on (popup, or the fatigue offer) locks it for LOCK_DAYS.
  if (area === 'sync' && changes.enabled?.newValue === true && changes.enabled.oldValue === false) {
    chrome.storage.sync.set({ lockedUntil: Date.now() + LOCK_DAYS * 24 * 60 * 60 * 1000 });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_ALARM) onSessionAlarm();
});
