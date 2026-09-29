// adapters/chrome/background.ts
//
// The extension's background worker: the only part that talks to the
// Worker. Content scripts can't make cross-origin requests themselves, and
// keeping the invite token here keeps it out of YouTube's page.
//
// It also tracks whether the Worker is reachable, and says so on the toolbar
// icon and in the popup ("Offline: showing everything"), so failing open is
// never silent. It keeps the session (core/session.ts), the commitment lock,
// and the session receipt (core/events.ts; in memory, logged in dev builds).
// Ported from extension/background.js.
/// <reference types="chrome" />

import type { WorthwhileEvent } from '../../contracts/events';
import type { ProfileReply, WorthwhileMessage } from '../../contracts/messages';
import { postToServer, SOURCE_TIMEOUT_MS, TIMEOUT_MS, type ServerStatus } from '../../core/classifier';
import { profileUrlOf } from '../../core/config';
import { ReceiptTally } from '../../core/events';
import { loadTasteProfile, profileFromSettings, toServerProfile } from '../../core/profile';
import { createSessionTracker, SESSION_ALARM } from '../../core/session';
import { createStores, LOCK_DAYS } from '../../core/settings';
import { CONFIG } from './config';
import { ChromeHttp, ChromeMessaging, ChromeStorage } from './platform';

const HEALTH_TIMEOUT_MS = 5000;

const settingsStore = new ChromeStorage('sync');
const localStore = new ChromeStorage('local');
const sessionStore = new ChromeStorage('session');
const stores = createStores(settingsStore, localStore);
const http = new ChromeHttp(settingsStore, localStore);
const server = { http, apiBaseUrl: CONFIG.apiBaseUrl, onStatus: setServerStatus };

// The session receipt, in memory (a restarted worker starts a fresh tally).
const receipt = new ReceiptTally();
function onEvents(events: WorthwhileEvent[]): void {
  for (const event of events) {
    receipt.record(event);
    if (CONFIG.dev) console.debug('[worthwhile]', JSON.stringify(event));
  }
  if (CONFIG.dev) console.debug('[worthwhile] receipt', JSON.stringify(receipt.receipt()), 'last', JSON.stringify(receipt.lastReceipt()));
}

const sessions = createSessionTracker({
  local: localStore,
  loadSettings: stores.loadSettings,
  postSessions: (records) => postToServer(server, '/session', { sessions: records }, TIMEOUT_MS),
  scheduleEnd: (when) => chrome.alarms.create(SESSION_ALARM, { when }),
  emit: (event) => onEvents([event]),
});

new ChromeMessaging().onMessage((message: WorthwhileMessage) => {
  switch (message?.type) {
    case 'score':
      return scoreItems(message.items);
    case 'scoreShorts':
      return scoreShorts(message.ids);
    case 'source':
      return sourceItems();
    case 'checkServer':
      return checkServer();
    case 'activity':
      return sessions.onActivity(message);
    case 'fatigue':
      return sessions.onFatigue();
    case 'rate':
      return sessions.onRate(message);
    case 'events':
      onEvents(Array.isArray(message.events) ? message.events : []);
      return Promise.resolve({ ok: true });
    case 'profile':
      return loadProfile();
    default:
      return undefined;
  }
});

// The taste profile: the website's, when signed in to it; otherwise the
// extension's own settings (exactly what was always sent).
async function loadProfile(): Promise<ProfileReply> {
  const settings = await stores.loadSettings();
  return loadTasteProfile({
    storage: localStore,
    http,
    profileUrl: CONFIG.profileUrl === '' ? '' : profileUrlOf(CONFIG),
    fallback: profileFromSettings(settings),
    onInvalid: (errors) => console.warn('Worthwhile: the website taste profile is invalid, so it is not used:', errors),
  });
}

// The profile sent with scoring requests. The user's newest corrections go
// along as labelled examples; they're part of the prompt, so a new
// correction re-scores (new cache key).
async function serverProfile() {
  const [settings, { corrections }, loaded] = await Promise.all([stores.loadSettings(), stores.loadLocal(), loadProfile()]);
  return toServerProfile(loaded, settings, corrections);
}

// Returns the Worker's reply ({ results: { videoId: { verdict, scores } } })
// or { error }. The content script shows everything on any error.
async function scoreItems(items: unknown) {
  return postToServer(server, '/score', { profile: await serverProfile(), items }, TIMEOUT_MS);
}

// Shorts by video ID (up to 20): the Worker looks up each one's details and
// thumbnail itself. Same reply shape as /score.
async function scoreShorts(ids: unknown) {
  return postToServer(server, '/score-shorts', { profile: await serverProfile(), ids }, TIMEOUT_MS);
}

// Approved videos from the user's interests and the channels they opened
// (remembered on this device): { items } or { error }.
async function sourceItems() {
  const { openedChannels } = await stores.loadLocal();
  const channels = openedChannels.slice(0, 20).map((c) => (c.id ? { id: c.id } : { handle: c.handle }));
  return postToServer(server, '/source', { profile: await serverProfile(), channels }, SOURCE_TIMEOUT_MS);
}

// The popup asks this each time it opens, so its status is current.
async function checkServer() {
  const { token } = await stores.loadSettings();
  if (!token) return setServerStatus('no-token');
  const response = await http.request({ method: 'GET', url: `${CONFIG.apiBaseUrl}/health`, auth: 'none', timeoutMs: HEALTH_TIMEOUT_MS }).catch(() => null);
  if (!response || 'error' in response) return setServerStatus('offline');
  const { serverStatus } = await sessionStore.get({ serverStatus: 'unknown' });
  // /health doesn't check the token, so keep a known "bad-token" until a real request succeeds.
  const ok = response.status >= 200 && response.status < 300;
  return setServerStatus(ok ? (serverStatus === 'bad-token' ? 'bad-token' : 'ok') : 'offline');
}

// serverStatus: 'ok' | 'offline' | 'bad-token' | 'no-token' | 'unknown'.
// Kept in session storage (cleared when the browser closes).
async function setServerStatus(serverStatus: ServerStatus) {
  await sessionStore.set({ serverStatus });
  await updateBadge();
  return { serverStatus };
}

// Toolbar icon: "OFF" while switched off; "!" while it can't filter
// (offline, or the invite token is missing or rejected).
async function updateBadge() {
  const [{ enabled }, { serverStatus }] = await Promise.all([stores.loadSettings(), sessionStore.get({ serverStatus: 'unknown' })]);
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
  if (alarm.name === SESSION_ALARM) sessions.onSessionAlarm();
});
