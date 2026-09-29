// adapters/chrome/content.ts
//
// The content script bootstrap (every youtube.com page, at document_start).
// Wires the Chrome implementations of core's interfaces into the desktop
// site's page code, then starts it in the order the separate scripts used
// to load: behaviour, home feed, /watch sidebar, /shorts.
/// <reference types="chrome" />

import type { TasteProfile } from '../../contracts/taste-profile';
import type { ProfileReply } from '../../contracts/messages';
import { MessagingClassifier } from '../../core/classifier';
import { EventEmitter } from '../../core/events';
import { createStores } from '../../core/settings';
import { startBehaviour } from '../../sites/youtube-desktop/behaviour';
import type { PageChannel, PageEnv } from '../../sites/youtube-desktop/env';
import { startHomeFeed } from '../../sites/youtube-desktop/feed';
import { startShorts } from '../../sites/youtube-desktop/shorts';
import { FROM_PAGE, TO_PAGE } from '../../sites/youtube-desktop/shorts-page';
import { startWatch } from '../../sites/youtube-desktop/watch';
import { CONFIG } from './config';
import { ChromeMessaging, ChromeStorage } from './platform';

const stores = createStores(new ChromeStorage('sync'), new ChromeStorage('local'));
const messaging = new ChromeMessaging();

// Analytics events go to the background worker in batches.
const events = new EventEmitter((batch) => messaging.send({ type: 'events', events: batch }), undefined, CONFIG.dev);

// The taste profile's extra rules. Asked for once at start and again when
// something it depends on changes; until then (or if the background can't
// answer) no extra rules apply.
let taste: TasteProfile | null = null;
function refreshTaste(): void {
  messaging
    .send<ProfileReply>({ type: 'profile' })
    .then((reply) => (taste = reply?.profile ?? null))
    .catch(() => {});
}
refreshTaste();
stores.settingsStore.onChanged?.((changes) => {
  if (changes.rubric || changes.interests) refreshTaste();
});
stores.localStore.onChanged?.((changes) => {
  if (changes.authToken || changes.tasteProfileCache) refreshTaste();
});

// window.postMessage to and from the part in YouTube's page world (page.ts).
const pageChannel: PageChannel = {
  post: (message) => window.postMessage({ source: TO_PAGE, ...message }, location.origin),
  onMessage: (handler) =>
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== FROM_PAGE) return;
      handler(event.data);
    }),
};

const env: PageEnv = { stores, messaging, classifier: new MessagingClassifier(messaging), events, taste: () => taste, pageChannel };

const { offerFilter } = startBehaviour(env);
startHomeFeed(env);
startWatch(env);
startShorts(env, offerFilter);
