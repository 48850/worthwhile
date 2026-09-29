// core/interfaces.ts
//
// What core needs from the place it runs in. Each adapter implements these:
//   adapters/chrome        chrome.storage, chrome.runtime, fetch
//   adapters/ios-webview   window.webkit.messageHandlers.worthwhile
// and each site (sites/youtube-desktop, sites/youtube-mobile) implements
// SiteAdapter. Core and sites never reach a host API any other way
// (scripts/check-boundaries.mjs enforces it).

import type { WorthwhileMessage } from '../contracts/messages';
import type { ClassifyResult, FeedItem } from './types';

export type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;

/**
 * A key-value store. get() takes defaults, like chrome.storage: every key
 * in `defaults` comes back, with the stored value if there is one.
 */
export interface Storage {
  get<T extends object>(defaults: T): Promise<T>;
  set(values: Record<string, unknown>): Promise<void>;
  /**
   * Called with what changed, whichever part of the app changed it. Optional
   * for a host that has no other writers; the Chrome extension relies on it
   * (a setting changed in the popup applies at once in every YouTube tab).
   */
  onChanged?(listener: (changes: StorageChanges) => void): void;
}

/** Request/response messages to the host (Chrome: the background worker; iOS: the app). */
export interface Messaging {
  /** Resolves with the reply. Rejects if nothing is listening (e.g. the extension was reloaded). */
  send<R = unknown>(message: WorthwhileMessage): Promise<R>;
  /** A handler returns a reply (or a promise of one), or undefined for messages it doesn't handle. */
  onMessage(handler: (message: WorthwhileMessage) => unknown): void;
}

/** Everything about one site's page structure that a feed filter needs. */
export interface SiteAdapter<Item extends FeedItem = FeedItem> {
  /** Every item card inside root, in page order. */
  findItems(root: ParentNode): Element[];
  /** The item a card shows, or null for anything that isn't a plain video (ads, mixes, playlists, unfilled cards). */
  readItem(card: Element): Item | null;
  hideItem(card: Element): void;
  /** Undoes hideItem (and reveals a card that was waiting for its verdict). */
  showItem(card: Element): void;
  markHallmarked(card: Element): void;
  /** Calls onChange (debounced by the caller) whenever root's content changes. Returns a function that stops observing. */
  observe(root: Node, onChange: () => void): () => void;
}

/** Scores items and returns the server's verdicts. */
export interface Classifier {
  classify(items: FeedItem[]): Promise<ClassifyResult>;
  /** Shorts by video ID: the server looks up their details itself. */
  classifyShorts(ids: string[]): Promise<ClassifyResult>;
}

/** Who a request authenticates as; the adapter adds the actual token, so tokens never pass through page scripts. */
export type HttpAuth = 'invite' | 'account' | 'none';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  auth: HttpAuth;
  timeoutMs: number;
}

/** status + parsed JSON body, or why no response came back ('no-token': the auth it needs isn't set). */
export type HttpResponse = { status: number; body: unknown } | { error: 'network' | 'no-token'; detail?: string };

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}
