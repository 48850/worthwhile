// adapters/chrome/ui/chips.ts
//
// The interests editor: one chip per interest with an x to remove it, and a
// text box where Enter adds one. Used by both the toolbar popup and the
// options page. Saves straight to the settings store, and redraws whenever
// the interests change anywhere (so the popup and options page stay in step).
// Content scripts see the change too and re-score the feed.
// Ported unchanged from extension/chips.js.

import { SETTINGS_LIMITS, type Stores } from '../../../core/settings';

export function mountInterestChips(container: HTMLElement, stores: Stores): { focus: () => void } {
  const list = document.createElement('div');
  list.className = 'chips';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chips-input';
  input.placeholder = 'Add an interest, press Enter';
  input.maxLength = SETTINGS_LIMITS.interestLength;
  input.setAttribute('aria-label', 'Add an interest');
  const note = document.createElement('div');
  note.className = 'chips-note';
  container.replaceChildren(list, input, note);

  let interests: string[] = [];

  function draw(): void {
    list.replaceChildren(
      ...interests.map((name) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const label = document.createElement('span');
        label.textContent = name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chip-x';
        remove.textContent = '×';
        remove.title = `Remove ${name}`;
        remove.setAttribute('aria-label', `Remove ${name}`);
        remove.addEventListener('click', () => save(interests.filter((i) => i !== name)));
        chip.append(label, remove);
        return chip;
      }),
    );
    note.textContent = interests.length ? '' : 'No interests yet. Add a few topics you want more of.';
  }

  function save(next: string[]): Promise<void> {
    interests = next;
    draw();
    return stores.settingsStore.set({ interests: next });
  }

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (interests.some((i) => i.toLowerCase() === name.toLowerCase())) {
      note.textContent = `"${name}" is already on the list.`;
      input.select();
      return;
    }
    if (interests.length >= SETTINGS_LIMITS.interests) {
      note.textContent = `That's the maximum of ${SETTINGS_LIMITS.interests}. Remove one first.`;
      return;
    }
    input.value = '';
    save([...interests, name]);
  });

  stores.settingsStore.onChanged?.((changes) => {
    if (changes.interests) {
      interests = (changes.interests.newValue as string[]) || [];
      draw();
    }
  });
  stores.loadSettings().then((s) => {
    interests = s.interests;
    draw();
  });

  return { focus: () => input.focus() };
}
