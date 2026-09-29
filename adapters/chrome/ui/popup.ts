// adapters/chrome/ui/popup.ts
//
// The toolbar popup: the on/off switch (with the commitment lock), the
// interests chips, and status notes. The full rubric, strictness and invite
// token live on the options page.
// Ported unchanged from extension/popup.js.
/// <reference types="chrome" />

import type { Settings } from '../../../core/settings';
import { createStores } from '../../../core/settings';
import { ChromeMessaging, ChromeStorage } from '../platform';
import { mountInterestChips } from './chips';

const stores = createStores(new ChromeStorage('sync'), new ChromeStorage('local'));
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const enabledBox = byId<HTMLInputElement>('enabled');
const enabledLabel = byId('enabled-label');
const tokenWarning = byId('token-warning');

function showEnabled(on: boolean): void {
  enabledBox.checked = on;
  enabledLabel.textContent = on ? 'Filter on' : 'Filter off';
}

stores.loadSettings().then((s) => {
  showEnabled(s.enabled);
  tokenWarning.hidden = Boolean(s.token);
});

// Server status: shown from the last known state straight away, then
// re-checked (the background worker pings the Worker).
const offline = byId('offline');
function showStatus(status: string | undefined): void {
  offline.hidden = status !== 'offline';
  if (status === 'bad-token') {
    tokenWarning.hidden = false;
    tokenWarning.firstChild!.textContent = "Your invite token wasn't accepted, so nothing is filtered. Check it in ";
  }
}
new ChromeStorage('session').get({ serverStatus: 'unknown' }).then(({ serverStatus }) => showStatus(serverStatus));
new ChromeMessaging().send<{ serverStatus?: string }>({ type: 'checkServer' }).then(
  (reply) => showStatus(reply?.serverStatus),
  () => {},
);

// Commitment lock (M4): while locked, switching off opens the lock panel
// instead: a 60-second countdown plus a typed reason. The reason stays in
// this popup: it isn't stored or sent anywhere.
const LOCK_WAIT_S = 60;
const MIN_REASON_CHARS = 10;
const lockPanel = byId('lock-panel');
const lockReason = byId<HTMLTextAreaElement>('lock-reason');
const lockConfirm = byId<HTMLButtonElement>('lock-confirm');
let lockTimer: ReturnType<typeof setInterval> | undefined;
let secondsLeft = LOCK_WAIT_S;

function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function showLockNote(s: Settings): void {
  const note = byId('lock-note');
  const locked = s.enabled && s.lockedUntil > Date.now();
  note.hidden = !locked;
  if (locked) note.textContent = `Locked on until ${dateText(s.lockedUntil)}.`;
}
stores.loadSettings().then(showLockNote);

function updateLockButton(): void {
  const reasonOk = lockReason.value.trim().length >= MIN_REASON_CHARS;
  lockConfirm.disabled = secondsLeft > 0 || !reasonOk;
  lockConfirm.textContent = secondsLeft > 0 ? `Switch off (${secondsLeft})` : reasonOk ? 'Switch off' : 'Say why first';
}

function openLockPanel(lockedUntil: number): void {
  byId('lock-until').textContent = dateText(lockedUntil);
  lockPanel.hidden = false;
  secondsLeft = LOCK_WAIT_S;
  updateLockButton();
  clearInterval(lockTimer);
  lockTimer = setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    updateLockButton();
    if (secondsLeft === 0) clearInterval(lockTimer);
  }, 1000);
  lockReason.focus();
}

function closeLockPanel(): void {
  clearInterval(lockTimer);
  lockPanel.hidden = true;
  lockReason.value = '';
}

lockReason.addEventListener('input', updateLockButton);
lockConfirm.addEventListener('click', async () => {
  if (secondsLeft > 0 || lockReason.value.trim().length < MIN_REASON_CHARS) return;
  closeLockPanel();
  showEnabled(false);
  await stores.settingsStore.set({ enabled: false, lockedUntil: 0 });
  stores.loadSettings().then(showLockNote);
});
byId('lock-cancel').addEventListener('click', closeLockPanel);

enabledBox.addEventListener('change', async () => {
  const s = await stores.loadSettings();
  if (!enabledBox.checked && s.lockedUntil > Date.now()) {
    showEnabled(true); // stays on unless the lock panel is completed
    openLockPanel(s.lockedUntil);
    return;
  }
  closeLockPanel();
  showEnabled(enabledBox.checked);
  await stores.settingsStore.set({ enabled: enabledBox.checked }); // switching on starts the lock (background)
  setTimeout(() => stores.loadSettings().then(showLockNote), 300);
});

for (const link of document.querySelectorAll('.open-options')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

mountInterestChips(byId('interests'), stores).focus();

// Channels remembered for sourcing (this device only), with a way to clear them.
const channelsNote = byId('channels-note');
function showChannels(list: { name?: string; handle?: string; id?: string }[]): void {
  channelsNote.hidden = list.length === 0;
  byId('channels-count').textContent = list.length === 1 ? '1 channel' : `${list.length} channels`;
  channelsNote.title = list.map((c) => c.name || c.handle || c.id).join(', ');
}
stores.loadLocal().then(({ openedChannels }) => showChannels(openedChannels));
byId('forget-channels').addEventListener('click', async () => {
  await stores.localStore.set({ openedChannels: [] });
  showChannels([]);
});

// How many bait Shorts were kept out of YouTube's lists today (this device).
stores.loadShortsToday().then(({ removed }) => {
  const note = byId('shorts-removed');
  note.hidden = removed === 0;
  note.textContent = `Shorts: ${removed} bait Short${removed === 1 ? '' : 's'} removed today.`;
});
