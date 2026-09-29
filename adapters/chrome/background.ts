// adapters/chrome/background.ts
//
// The extension's background worker: the only part that talks to the
// Worker. Content scripts can't make cross-origin requests themselves, and
// keeping the invite token here keeps it out of YouTube's page.
//
// The message handling itself is core/host.ts (shared with the iOS
// WebView). This file adds what's Chrome's own: the toolbar badge (so
// failing open is never silent), the commitment lock on install and on
// switching on, the session-end alarm, and the session receipt (in memory,
// logged in development builds).
// Ported from extension/background.js.
/// <reference types="chrome" />

import type { WorthwhileEvent } from '../../contracts/events';
import type { WorthwhileMessage } from '../../contracts/messages';
import { ReceiptTally } from '../../core/events';
import { createHost } from '../../core/host';
import { SESSION_ALARM } from '../../core/session';
import { createStores, LOCK_DAYS } from '../../core/settings';
import { CONFIG } from './config';
import { ChromeHttp, ChromeMessaging, ChromeStorage } from './platform';

const settingsStore = new ChromeStorage('sync');
const localStore = new ChromeStorage('local');
const sessionStore = new ChromeStorage('session');
const stores = createStores(settingsStore, localStore);

// The session receipt, in memory (a restarted worker starts a fresh tally).
const receipt = new ReceiptTally();
function onEvents(events: WorthwhileEvent[]): void {
  for (const event of events) {
    receipt.record(event);
    if (CONFIG.dev) console.debug('[worthwhile]', JSON.stringify(event));
  }
  if (CONFIG.dev) console.debug('[worthwhile] receipt', JSON.stringify(receipt.receipt()), 'last', JSON.stringify(receipt.lastReceipt()));
}

const host = createHost({
  stores,
  http: new ChromeHttp(settingsStore, localStore),
  config: CONFIG,
  statusStore: sessionStore, // cleared when the browser closes
  onStatusChange: updateBadge,
  scheduleSessionEnd: (when) => chrome.alarms.create(SESSION_ALARM, { when }),
  onEvents,
  log: console,
});

new ChromeMessaging().onMessage((message: WorthwhileMessage) => host.handle(message));

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
  if (alarm.name === SESSION_ALARM) host.sessions.onSessionAlarm();
});
