// sites/youtube-desktop/env.ts
//
// What the page code needs from its host, handed over by the adapter's
// bootstrap (adapters/chrome/content.ts). Nothing in sites/ reaches a host
// API any other way.

import type { TasteProfile } from '../../contracts/taste-profile';
import type { EventEmitter } from '../../core/events';
import type { Classifier, Messaging } from '../../core/interfaces';
import type { Stores } from '../../core/settings';

export interface PageEnv {
  /** Settings (synced) and device-only data, with their helpers. */
  stores: Stores;
  /** Requests to the host (Chrome: the background worker). */
  messaging: Messaging;
  classifier: Classifier;
  events: EventEmitter;
  /** The taste profile's extra rules, or null for none. */
  taste: () => TasteProfile | null;
  /** Tell YouTube's page-world script (shorts-page.ts) something, and hear from it. */
  pageChannel: PageChannel;
}

/** Messages between this script and the part running in YouTube's own page context. */
export interface PageChannel {
  post(message: Record<string, unknown>): void;
  onMessage(handler: (data: any) => void): void;
}
