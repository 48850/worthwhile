// adapters/chrome/ui/options.ts
//
// The options page: invite token, rubric and strictness (saved with the Save
// button), Shorts settings, Collect Shorts, hidden channels, plus the same
// interests chips as the toolbar popup.
// Ported unchanged from extension/options.js.

import { createStores, DEFAULT_SETTINGS, SETTINGS_LIMITS, type CollectedShort } from '../../../core/settings';
import { ChromeStorage } from '../platform';
import { mountInterestChips } from './chips';

const stores = createStores(new ChromeStorage('sync'), new ChromeStorage('local'));
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const form = byId<HTMLFormElement>('settings');
const token = byId<HTMLInputElement>('token');
const rubric = byId<HTMLTextAreaElement>('rubric');
const rubricCount = byId('rubric-count');
const strictness = byId<HTMLInputElement>('strictness');
const strictnessLabel = byId('strictness-label');
const saved = byId('saved');
const shortsLabels = byId<HTMLInputElement>('shorts-labels');
const hideShortsShelf = byId<HTMLInputElement>('hide-shorts-shelf');
const shortsRemove = byId<HTMLInputElement>('shorts-remove');
const shortsRemoveLevel = byId<HTMLSelectElement>('shorts-remove-level');

// The removal level only matters while removal is on.
function showRemoveLevel(): void {
  shortsRemoveLevel.disabled = !shortsRemove.checked;
  byId('shorts-level-row').style.opacity = shortsRemove.checked ? '1' : '0.5';
}
shortsRemove.addEventListener('change', showRemoveLevel);

// Hidden channels: listed with an Unhide button each, saved immediately.
function showHiddenChannels(list: string[]): void {
  const ul = byId('hidden-channels');
  ul.replaceChildren(
    ...list.map((name) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = name;
      const unhide = document.createElement('button');
      unhide.type = 'button';
      unhide.className = 'link';
      unhide.textContent = 'Unhide';
      unhide.addEventListener('click', () => stores.setChannelHidden(name, false));
      li.append(label, unhide);
      return li;
    }),
  );
  byId('no-hidden-channels').hidden = list.length > 0;
}
stores.settingsStore.onChanged?.((changes) => {
  if (changes.hiddenChannels) showHiddenChannels((changes.hiddenChannels.newValue as string[]) || []);
});

const STRICTNESS_NAMES: Record<string, string> = {
  1: '1: lenient',
  2: '2: default',
  3: '3: balanced',
  4: '4: strict',
  5: '5: very strict',
};

rubric.maxLength = SETTINGS_LIMITS.rubricLength;

const ruleInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="rule"]')];

function showStrictness(): void {
  strictnessLabel.textContent = STRICTNESS_NAMES[strictness.value];
  // Strictness only applies to the Strict rule.
  const strict = ruleInputs.find((r) => r.checked)?.value === 'strict';
  strictness.disabled = !strict;
  byId('strictness-row').style.opacity = strict ? '1' : '0.5';
}
ruleInputs.forEach((r) => r.addEventListener('change', showStrictness));

function showRubricCount(): void {
  rubricCount.textContent = `${rubric.value.length} / ${SETTINGS_LIMITS.rubricLength} characters`;
}

stores.loadSettings().then((s) => {
  token.value = s.token;
  rubric.value = s.rubric;
  strictness.value = String(s.strictness);
  shortsLabels.checked = s.shortsLabels;
  hideShortsShelf.checked = s.hideShortsShelf;
  shortsRemove.checked = s.shortsRemove;
  shortsRemoveLevel.value = String(s.shortsRemoveLevel);
  showRemoveLevel();
  showHiddenChannels(s.hiddenChannels);
  for (const r of ruleInputs) r.checked = r.value === s.rule;
  showStrictness();
  showRubricCount();
});

strictness.addEventListener('input', showStrictness);
rubric.addEventListener('input', showRubricCount);

byId('reset-rubric').addEventListener('click', () => {
  rubric.value = DEFAULT_SETTINGS.rubric;
  showRubricCount();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await stores.settingsStore.set({
    token: token.value.trim(),
    rubric: rubric.value.trim() || DEFAULT_SETTINGS.rubric,
    rule: ruleInputs.find((r) => r.checked)?.value || 'bait',
    strictness: Number(strictness.value),
    shortsLabels: shortsLabels.checked,
    hideShortsShelf: hideShortsShelf.checked,
    shortsRemove: shortsRemove.checked,
    shortsRemoveLevel: Number(shortsRemoveLevel.value),
  });
  saved.textContent = 'Saved.';
  setTimeout(() => (saved.textContent = ''), 2500);
});

mountInterestChips(byId('interests'), stores);

// Shorts removed from YouTube's lists (this device only): today's count and
// the most recent ones, each a link so the user can check it.
async function showRemoved(): Promise<void> {
  const [today, { removedShorts }] = await Promise.all([stores.loadShortsToday(), stores.loadLocal()]);
  byId('removed-status').textContent = removedShorts.length ? `Removed today: ${today.removed}. The most recent (open one to check it):` : '';
  byId('removed-shorts').replaceChildren(
    ...removedShorts.slice(0, 20).map((s) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/shorts/${s.id}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = `youtube.com/shorts/${s.id}`;
      li.append(link, document.createTextNode(` bait ${s.bait}, ${new Date(s.at).toLocaleString()}`));
      return li;
    }),
  );
}
showRemoved();
stores.localStore.onChanged?.((changes) => {
  if (changes.removedShorts || changes.shortsToday) showRemoved();
});

// ---------------------------------------------------------------------------
// Collect Shorts (testing): toggle, summary, copy as CSV, clear
// ---------------------------------------------------------------------------

const collectBox = byId<HTMLInputElement>('collect-shorts');
const collectStatus = byId('collect-status');
const copyStatus = byId('copy-status');

stores.loadSettings().then((s) => (collectBox.checked = s.collectShorts));
collectBox.addEventListener('change', () => stores.settingsStore.set({ collectShorts: collectBox.checked })); // saves straight away

// "Collected 42 Shorts. The queue listed 40 of 41 in advance (98%), typically 12 s before they played."
// Only rows from the network-list check count (they have a lead field;
// the first, slot-based version didn't).
function showCollected(list: CollectedShort[]): void {
  const checked = list.filter((s) => s.queued !== 'unknown' && 'lead' in s);
  const judged = list.filter((s) => 'verdictReady' in s);
  const ready = judged.filter((s) => s.verdictReady).length;
  const queued = checked.filter((s) => s.queued === 'yes');
  const leads = queued
    .map((s) => s.lead)
    .filter((l): l is number => l != null)
    .sort((a, b) => a - b);
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : null;
  const shortest = leads.length ? leads[0] : null;
  const labelled = list.filter((s) => s.verdict).length;
  collectStatus.textContent =
    `Collected ${list.length} Short${list.length === 1 ? '' : 's'}, ${labelled} labelled.` +
    (checked.length
      ? ` The queue listed ${queued.length} of ${checked.length} in advance (${Math.round((100 * queued.length) / checked.length)}%)` +
        (median != null ? `, typically ${median} s before they played (shortest ${shortest} s).` : '.')
      : '') +
    (judged.length ? ` Verdict ready in time for ${ready} of ${judged.length} (${Math.round((100 * ready) / judged.length)}%).` : '');
}
stores.loadLocal().then(({ collectedShorts }) => showCollected(collectedShorts));
stores.localStore.onChanged?.((changes) => {
  if (changes.collectedShorts) showCollected((changes.collectedShorts.newValue as CollectedShort[]) || []);
});

// CSV for npm run eval (and scripts/score-test.js --shorts): video_id, title,
// channel, my_verdict and junk (blank, to fill in), and the queue check.
byId('copy-shorts').addEventListener('click', async () => {
  const { collectedShorts } = await stores.loadLocal();
  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = collectedShorts.map((s) =>
    [
      s.id,
      s.title,
      s.channel,
      s.verdict ?? '', // labelled with S / H / J while collecting, else blank to fill in
      s.junk == null ? '' : s.junk ? 'yes' : 'no',
      s.queued === 'yes' ? (s.lead != null ? `queued ${s.lead}s ahead` : `queued ${s.ahead ?? '?'} ahead`) : s.queued === 'no' ? 'not queued' : 'unknown',
    ]
      .map(quote)
      .join(','),
  );
  const csv = ['video_id,title,channel,my_verdict,junk,queue_check', ...rows].join('\n') + '\n';
  try {
    await navigator.clipboard.writeText(csv);
    copyStatus.textContent = `Copied ${rows.length} rows.`;
  } catch {
    copyStatus.textContent = "Couldn't copy. Click the page first, then try again.";
  }
  setTimeout(() => (copyStatus.textContent = ''), 3000);
});

byId('clear-shorts').addEventListener('click', async () => {
  if (!confirm('Clear the collected Shorts list?')) return;
  await stores.localStore.set({ collectedShorts: [] });
});
