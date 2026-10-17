// adapters/ios-webview/bootstrap.ts
//
// dist/ios/filter.js: Worthwhile inside the iOS app's WKWebView on
// m.youtube.com, injected as a WKUserScript (see README.md). Everything the
// Chrome extension splits between a background worker and content scripts
// runs here in the page; storage, HTTP and events go to the app through the
// bridge.
//
// What works now: config, storage, the scoring client, the taste profile
// (from the app, else the website, else the default), sessions and
// heartbeats, analytics events and the receipt, and core's feed filter.
// What's stubbed: everything that reads m.youtube.com's page
// (sites/youtube-mobile), so until those selectors are filled in the
// filter finds no cards and YouTube shows as normal.
//
// Fail safe: no config, no bridge or any error means YouTube as normal.

import { MessagingClassifier } from '../../core/classifier';
import { takeCounts } from '../../core/counts';
import { EventEmitter, ReceiptTally } from '../../core/events';
import { createFeedFilter } from '../../core/feed-filter';
import { createHost } from '../../core/host';
import { createStores, DEFAULT_SETTINGS, type Correction, type Settings } from '../../core/settings';
import type { TasteProfile } from '../../contracts/taste-profile';
import type { Verdict } from '../../core/types';
import { findHomeFeed, hideOpenInAppBanners, hideShortsShelf, injectMobileCss, installMobileShorts, mobileSite } from '../../sites/youtube-mobile/adapter';
import { hasBridge, onAppMessage, readConfig, toApp, type IosConfig } from './bridge';
import { IosHttp, IosMessaging, IosStorage } from './platform';

const HEARTBEAT_MS = 15000;
const FEED_CHECK_MS = 1000;

const config = readConfig();
if (!config) console.warn('Worthwhile: no window.__WORTHWHILE_CONFIG__ (with apiBaseUrl), so the filter is off.');
else if (!hasBridge()) console.warn('Worthwhile: not inside the app (no webkit message handler), so the filter is off.');
else {
  try {
    start(config);
  } catch (err) {
    console.error('Worthwhile hit an error and left YouTube alone:', err);
  }
}

function start(config: IosConfig): void {
  const log = (level: 'debug' | 'warn' | 'error', text: string) => {
    (level === 'debug' ? console.debug : level === 'warn' ? console.warn : console.error)(text);
    if (config.dev) toApp({ type: 'log', level, text }).catch(() => {});
  };

  const settingsStore = new IosStorage('settings', config.settings);
  const localStore = new IosStorage('local');
  const stores = createStores(settingsStore, localStore);
  const messaging = new IosMessaging();

  // The session receipt, in memory; the app asks for it with receipt.request.
  const receipt = new ReceiptTally();
  onAppMessage((message) => (message.type === 'receipt.request' ? { current: receipt.receipt(), last: receipt.lastReceipt() } : undefined));

  // The host side of every app message, right here (no background worker).
  let sessionEndTimer: ReturnType<typeof setTimeout> | undefined;
  const host = createHost({
    stores,
    http: new IosHttp(),
    config,
    statusStore: new IosStorage('session'),
    scheduleSessionEnd: (when) => {
      clearTimeout(sessionEndTimer);
      sessionEndTimer = setTimeout(() => host.sessions.onSessionAlarm(), Math.max(0, when - Date.now()));
    },
    // Every event passes here once (the page's, and the host's own session
    // events): tallied, logged in development builds, and sent on to the app
    // (which doesn't send them anywhere yet).
    onEvents: (events) => {
      events.forEach((event) => receipt.record(event));
      if (config.dev) events.forEach((event) => log('debug', `[worthwhile] ${JSON.stringify(event)}`));
      if (events.length) toApp({ type: 'message', message: { type: 'events', events } }).catch(() => {});
    },
    givenProfile: () => config.profile,
    log: { warn: (...args) => log('warn', args.map(String).join(' ')) },
  });
  messaging.onMessage((message) => host.handle(message));

  // Events: batched into 'events' messages to the host (which logs, tallies and forwards them).
  const events = new EventEmitter((batch) => messaging.send({ type: 'events', events: batch }), undefined, false);

  // What the feed filter needs to know, kept current.
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let taste: TasteProfile | null = null;
  const overrides = new Map<string, Verdict>();
  const refresh = () => {
    stores.loadSettings().then((s) => {
      settings = s;
      hideShortsShelf(s.enabled && s.hideShortsShelf);
    });
    stores.loadLocal().then((local) => {
      overrides.clear();
      local.corrections.forEach((c: Correction) => overrides.set(c.videoId, c.verdict));
    });
    host.loadProfile().then((reply) => (taste = reply.profile), () => (taste = null));
  };
  refresh();
  settingsStore.onChanged(refresh);
  localStore.onChanged(refresh);

  // The feed filter, on m.youtube.com's home feed (found by the mobile adapter).
  injectMobileCss();
  const filter = createFeedFilter({
    site: mobileSite,
    classifier: new MessagingClassifier(messaging),
    events,
    state: () => ({ active: settings.enabled && Boolean(settings.token), taste, hiddenChannels: settings.hiddenChannels, overrides }),
  });
  let feed: (ParentNode & Node) | null = null;
  setInterval(() => {
    const found = findHomeFeed();
    if (found !== feed) {
      feed = found;
      if (feed) filter.start(feed);
      else filter.stop();
    }
    hideOpenInAppBanners();
  }, FEED_CHECK_MS);
  installMobileShorts();

  // Heartbeats keep the session (core/session.ts). The rating question and
  // the fatigue offer come back in the reply; showing them is the app's job
  // (TODO: a native prompt), so for now they're only logged.
  const beat = () => {
    const active = document.visibilityState === 'visible';
    events.flush();
    messaging
      .send<{ askRating?: unknown; offerFilter?: unknown }>({ type: 'activity', active, counts: takeCounts() })
      .then((reply) => {
        if (reply?.askRating || reply?.offerFilter) log('debug', `[worthwhile] activity reply ${JSON.stringify(reply)}`);
      })
      .catch(() => {});
  };
  setInterval(() => document.visibilityState === 'visible' && beat(), HEARTBEAT_MS);
  document.addEventListener('visibilitychange', beat);
  beat();
}
