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

enabledBox.addEventListener('change', () => {
  showEnabled(enabledBox.checked);
  chrome.storage.sync.set({ enabled: enabledBox.checked });
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
