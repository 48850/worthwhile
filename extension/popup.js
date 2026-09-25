// extension/popup.js
//
// The toolbar popup: the on/off switch and the interests chips.
// The full rubric, strictness and invite token live on the options page.

const enabledBox = document.getElementById('enabled');
const enabledLabel = document.getElementById('enabled-label');
const tokenWarning = document.getElementById('token-warning');

function showEnabled(on) {
  enabledBox.checked = on;
  enabledLabel.textContent = on ? 'Filter on' : 'Filter off';
}

loadSettings().then((s) => {
  showEnabled(s.enabled);
  tokenWarning.hidden = Boolean(s.token);
});

// Server status: shown from the last known state straight away, then
// re-checked (background.js pings the Worker).
const offline = document.getElementById('offline');
function showStatus(status) {
  offline.hidden = status !== 'offline';
  if (status === 'bad-token') {
    tokenWarning.hidden = false;
    tokenWarning.firstChild.textContent = 'Your invite token wasn\'t accepted, so nothing is filtered. Check it in ';
  }
}
chrome.storage.session.get({ serverStatus: 'unknown' }).then(({ serverStatus }) => showStatus(serverStatus));
chrome.runtime.sendMessage({ type: 'checkServer' }).then((reply) => showStatus(reply?.serverStatus), () => {});

// Commitment lock (M4): while locked, switching off opens the lock panel
// instead: a 60-second countdown plus a typed reason. The reason stays in
// this popup: it isn't stored or sent anywhere.
const LOCK_WAIT_S = 60;
const MIN_REASON_CHARS = 10;
const lockPanel = document.getElementById('lock-panel');
const lockReason = document.getElementById('lock-reason');
const lockConfirm = document.getElementById('lock-confirm');
let lockTimer = 0;
let secondsLeft = LOCK_WAIT_S;

function dateText(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function showLockNote(s) {
  const note = document.getElementById('lock-note');
  const locked = s.enabled && s.lockedUntil > Date.now();
  note.hidden = !locked;
  if (locked) note.textContent = `Locked on until ${dateText(s.lockedUntil)}.`;
}
loadSettings().then(showLockNote);

function updateLockButton() {
  const reasonOk = lockReason.value.trim().length >= MIN_REASON_CHARS;
  lockConfirm.disabled = secondsLeft > 0 || !reasonOk;
  lockConfirm.textContent = secondsLeft > 0 ? `Switch off (${secondsLeft})` : reasonOk ? 'Switch off' : 'Say why first';
}

function openLockPanel(lockedUntil) {
  document.getElementById('lock-until').textContent = dateText(lockedUntil);
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

function closeLockPanel() {
  clearInterval(lockTimer);
  lockPanel.hidden = true;
  lockReason.value = '';
}

lockReason.addEventListener('input', updateLockButton);
lockConfirm.addEventListener('click', async () => {
  if (secondsLeft > 0 || lockReason.value.trim().length < MIN_REASON_CHARS) return;
  closeLockPanel();
  showEnabled(false);
  await chrome.storage.sync.set({ enabled: false, lockedUntil: 0 });
  loadSettings().then(showLockNote);
});
document.getElementById('lock-cancel').addEventListener('click', closeLockPanel);

enabledBox.addEventListener('change', async () => {
  const s = await loadSettings();
  if (!enabledBox.checked && s.lockedUntil > Date.now()) {
    showEnabled(true); // stays on unless the lock panel is completed
    openLockPanel(s.lockedUntil);
    return;
  }
  closeLockPanel();
  showEnabled(enabledBox.checked);
  await chrome.storage.sync.set({ enabled: enabledBox.checked }); // switching on starts the lock (background.js)
  setTimeout(() => loadSettings().then(showLockNote), 300);
});

for (const link of document.querySelectorAll('.open-options')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

mountInterestChips(document.getElementById('interests')).focus();

// Channels remembered for sourcing (this device only), with a way to clear them.
const channelsNote = document.getElementById('channels-note');
function showChannels(list) {
  channelsNote.hidden = list.length === 0;
  document.getElementById('channels-count').textContent = list.length === 1 ? '1 channel' : `${list.length} channels`;
  channelsNote.title = list.map((c) => c.name || c.handle || c.id).join(', ');
}
loadLocal().then(({ openedChannels }) => showChannels(openedChannels));
document.getElementById('forget-channels').addEventListener('click', async () => {
  await chrome.storage.local.set({ openedChannels: [] });
  showChannels([]);
});

// How many bait Shorts were kept out of YouTube's lists today (this device).
loadShortsToday().then(({ removed }) => {
  const note = document.getElementById('shorts-removed');
  note.hidden = removed === 0;
  note.textContent = `Shorts: ${removed} bait Short${removed === 1 ? '' : 's'} removed today.`;
});
