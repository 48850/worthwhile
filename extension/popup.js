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
