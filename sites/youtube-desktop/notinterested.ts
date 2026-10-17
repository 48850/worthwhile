// sites/youtube-desktop/notinterested.ts
//
// Tells YouTube "Not interested" about one hidden home-feed card, using
// YouTube's own menu the way a person would: open the card's ⋮ menu, click
// "Not interested". Only ever run from the button in the Hidden drawer
// (feed.ts), which does at most 10 per click with 1-3 second pauses.
// Never run automatically.
//
// Checked live (signed out, Sept 2026): the ⋮ button opens a menu sheet
// whose items are buttons, even while the card is off screen. The "Not
// interested" item only exists when signed in, so it's matched by its label.

import { sleep, waitFor } from '../../core/util';
import { SELECTORS } from './selectors';

export type TellResult = 'ok' | 'no-menu-button' | 'no-menu' | 'no-option';

// Returns 'ok', or why it couldn't: 'no-menu-button', 'no-menu', 'no-option'.
export async function tellNotInterested(card: Element): Promise<TellResult> {
  closeMenus();
  card.setAttribute('data-ww-marking', ''); // give the hidden card a real size, off screen
  try {
    const button = card.querySelector<HTMLElement>(SELECTORS.cardMenuButton);
    if (!button) return 'no-menu-button';
    button.click();

    const items = await waitFor(() => {
      const visible = [...document.querySelectorAll(SELECTORS.menuItem)].filter((item) => item.getClientRects().length > 0);
      return visible.length ? visible : null;
    }, 3000);
    if (!items) return 'no-menu';

    const option = items.find((item) => SELECTORS.notInterestedLabel.test((item.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!option) {
      closeMenus();
      return 'no-option';
    }
    ((option.querySelector(SELECTORS.menuItemButton) || option) as HTMLElement).click();
    await sleep(400); // let YouTube swap the card for its "Video removed" notice
    return 'ok';
  } finally {
    card.removeAttribute('data-ww-marking');
  }
}

// Escape closes YouTube's menu sheet (checked live).
export function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
}
