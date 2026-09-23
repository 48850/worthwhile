// extension/options.js
//
// The options page: invite token, rubric and strictness (saved with the Save
// button), plus the same interests chips as the toolbar popup.

const form = document.getElementById('settings');
const token = document.getElementById('token');
const rubric = document.getElementById('rubric');
const rubricCount = document.getElementById('rubric-count');
const strictness = document.getElementById('strictness');
const strictnessLabel = document.getElementById('strictness-label');
const saved = document.getElementById('saved');

const STRICTNESS_NAMES = {
  1: '1: lenient',
  2: '2: default',
  3: '3: balanced',
  4: '4: strict',
  5: '5: very strict',
};

rubric.maxLength = SETTINGS_LIMITS.rubricLength;

function showStrictness() {
  strictnessLabel.textContent = STRICTNESS_NAMES[strictness.value];
}

function showRubricCount() {
  rubricCount.textContent = `${rubric.value.length} / ${SETTINGS_LIMITS.rubricLength} characters`;
}

loadSettings().then((s) => {
  token.value = s.token;
  rubric.value = s.rubric;
  strictness.value = String(s.strictness);
  showStrictness();
  showRubricCount();
});

strictness.addEventListener('input', showStrictness);
rubric.addEventListener('input', showRubricCount);

document.getElementById('reset-rubric').addEventListener('click', () => {
  rubric.value = DEFAULT_SETTINGS.rubric;
  showRubricCount();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({
    token: token.value.trim(),
    rubric: rubric.value.trim() || DEFAULT_SETTINGS.rubric,
    strictness: Number(strictness.value),
  });
  saved.textContent = 'Saved.';
  setTimeout(() => (saved.textContent = ''), 2500);
});

mountInterestChips(document.getElementById('interests'));
