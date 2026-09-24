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
const shortsLabels = document.getElementById('shorts-labels');
const hideShortsShelf = document.getElementById('hide-shorts-shelf');

// Hidden channels: listed with an Unhide button each, saved immediately.
function showHiddenChannels(list) {
  const ul = document.getElementById('hidden-channels');
  ul.replaceChildren(
    ...list.map((name) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = name;
      const unhide = document.createElement('button');
      unhide.type = 'button';
      unhide.className = 'link';
      unhide.textContent = 'Unhide';
      unhide.addEventListener('click', () => setChannelHidden(name, false));
      li.append(label, unhide);
      return li;
    }),
  );
  document.getElementById('no-hidden-channels').hidden = list.length > 0;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.hiddenChannels) showHiddenChannels(changes.hiddenChannels.newValue || []);
});

const STRICTNESS_NAMES = {
  1: '1: lenient',
  2: '2: default',
  3: '3: balanced',
  4: '4: strict',
  5: '5: very strict',
};

rubric.maxLength = SETTINGS_LIMITS.rubricLength;

const ruleInputs = [...document.querySelectorAll('input[name="rule"]')];

function showStrictness() {
  strictnessLabel.textContent = STRICTNESS_NAMES[strictness.value];
  // Strictness only applies to the Strict rule.
  const strict = ruleInputs.find((r) => r.checked)?.value === 'strict';
  strictness.disabled = !strict;
  document.getElementById('strictness-row').style.opacity = strict ? '1' : '0.5';
}
ruleInputs.forEach((r) => r.addEventListener('change', showStrictness));

function showRubricCount() {
  rubricCount.textContent = `${rubric.value.length} / ${SETTINGS_LIMITS.rubricLength} characters`;
}

loadSettings().then((s) => {
  token.value = s.token;
  rubric.value = s.rubric;
  strictness.value = String(s.strictness);
  shortsLabels.checked = s.shortsLabels;
  hideShortsShelf.checked = s.hideShortsShelf;
  showHiddenChannels(s.hiddenChannels);
  for (const r of ruleInputs) r.checked = r.value === s.rule;
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
    rule: ruleInputs.find((r) => r.checked)?.value || 'bait',
    strictness: Number(strictness.value),
    shortsLabels: shortsLabels.checked,
    hideShortsShelf: hideShortsShelf.checked,
  });
  saved.textContent = 'Saved.';
  setTimeout(() => (saved.textContent = ''), 2500);
});

mountInterestChips(document.getElementById('interests'));

// ---------------------------------------------------------------------------
// Collect Shorts (testing): toggle, summary, copy as CSV, clear
// ---------------------------------------------------------------------------

const collectBox = document.getElementById('collect-shorts');
const collectStatus = document.getElementById('collect-status');
const copyStatus = document.getElementById('copy-status');

loadSettings().then((s) => (collectBox.checked = s.collectShorts));
collectBox.addEventListener('change', () => chrome.storage.sync.set({ collectShorts: collectBox.checked })); // saves straight away

// "Collected 42 Shorts. The queue listed 40 of 41 in advance (98%), typically 12 s before they played."
// Rows from the older check (slots, not seconds) have no lead time and are left out.
// Only rows from the network-list check count ('queuedDom' marks them).
function showCollected(list) {
  const checked = list.filter((s) => s.queued !== 'unknown' && 'queuedDom' in s);
  const queued = checked.filter((s) => s.queued === 'yes');
  const leads = queued.map((s) => s.lead).filter((l) => l != null).sort((a, b) => a - b);
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : null;
  const shortest = leads.length ? leads[0] : null;
  collectStatus.textContent =
    `Collected ${list.length} Short${list.length === 1 ? '' : 's'}.` +
    (checked.length
      ? ` The queue listed ${queued.length} of ${checked.length} in advance (${Math.round((100 * queued.length) / checked.length)}%)` +
        (median != null ? `, typically ${median} s before they played (shortest ${shortest} s).` : '.')
      : '');
}
loadLocal().then(({ collectedShorts }) => showCollected(collectedShorts));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.collectedShorts) showCollected(changes.collectedShorts.newValue || []);
});

// CSV for scripts/score-test.js --shorts: video_id, title, channel, my_verdict
// (blank, to fill in), and the queue check.
document.getElementById('copy-shorts').addEventListener('click', async () => {
  const { collectedShorts } = await loadLocal();
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = collectedShorts.map((s) =>
    [s.id, s.title, s.channel, '', s.queued === 'yes' ? (s.lead != null ? `queued ${s.lead}s ahead` : `queued ${s.ahead ?? '?'} ahead`) : s.queued === 'no' ? 'not queued' : 'unknown']
      .map(quote)
      .join(','),
  );
  const csv = ['video_id,title,channel,my_verdict,queue_check', ...rows].join('\n') + '\n';
  try {
    await navigator.clipboard.writeText(csv);
    copyStatus.textContent = `Copied ${rows.length} rows.`;
  } catch {
    copyStatus.textContent = 'Couldn\'t copy. Click the page first, then try again.';
  }
  setTimeout(() => (copyStatus.textContent = ''), 3000);
});

document.getElementById('clear-shorts').addEventListener('click', async () => {
  if (!confirm('Clear the collected Shorts list?')) return;
  await chrome.storage.local.set({ collectedShorts: [] });
});
