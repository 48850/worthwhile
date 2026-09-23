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
