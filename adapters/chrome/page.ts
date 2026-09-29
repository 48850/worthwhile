// adapters/chrome/page.ts
//
// The script that runs in YouTube's own page context ("world": "MAIN" in
// manifest.json). No extension APIs exist there; it only intercepts
// YouTube's list of upcoming Shorts and reads its player
// (sites/youtube-desktop/shorts-page.ts).

import { installShortsPage } from '../../sites/youtube-desktop/shorts-page';

installShortsPage();
