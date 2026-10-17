// contracts/messages.ts
//
// Every message that crosses a boundary, and its reply.
//
// 1. App messages (Messaging.send). Chrome: content scripts -> background
//    worker. iOS: filter.js handles most of these itself, and sends only
//    'events' on to the app.
// 2. Bridge messages (iOS only): filter.js -> the app, through
//    window.webkit.messageHandlers.worthwhile.postMessage(), which returns a
//    Promise of the reply (WKScriptMessageHandlerWithReply). See
//    adapters/ios-webview/README.md for the Swift side.
// 3. App -> filter.js (iOS only): the app calls
//    window.__worthwhile.receive(message) with evaluateJavaScript.

import type { TasteProfile } from './taste-profile';
import type { WorthwhileEvent } from './events';
import type { HttpRequest, HttpResponse, StorageChanges } from '../core/interfaces';

// ---------------------------------------------------------------------------
// 1. App messages
// ---------------------------------------------------------------------------

export interface ScoreItem {
  id: string;
  title: string;
  channel: string;
  duration: string;
}

export type WorthwhileMessage =
  /** Score feed items. Reply: the Worker's /score reply ({ results }) or { error }. */
  | { type: 'score'; items: ScoreItem[] }
  /** Score Shorts by ID. Reply: the Worker's /score-shorts reply or { error }. */
  | { type: 'scoreShorts'; ids: string[] }
  /** Sourced videos for "Worth your time". Reply: { items } or { error }. */
  | { type: 'source' }
  /** Ping the server. Reply: { serverStatus }. */
  | { type: 'checkServer' }
  /** Heartbeat with counts. Reply: { sessionMinutes, askRating?, offerFilter? }. */
  | { type: 'activity'; active: boolean; counts: Record<string, number> }
  /** Fast Shorts swiping noticed. Reply: { offer: boolean }. */
  | { type: 'fatigue'; reason: string }
  /** The user's rating of their last session (null: skipped). Reply: { ok }. */
  | { type: 'rate'; sessionId: string; rating: number | null }
  /** Analytics events, batched. Reply: { ok: true }. Not sent anywhere yet. */
  | { type: 'events'; events: WorthwhileEvent[] }
  /** The taste profile in use. Reply: ProfileReply. */
  | { type: 'profile' };

export interface ProfileReply {
  profile: TasteProfile;
  /** 'server': fresh from the website; 'cache': an earlier copy; 'fallback': signed out, or the website's copy was unusable. */
  source: 'server' | 'cache' | 'fallback';
}

// ---------------------------------------------------------------------------
// 2. Bridge messages (iOS: filter.js -> app)
// ---------------------------------------------------------------------------

export type StorageArea = 'settings' | 'local' | 'session';

export type BridgeMessage =
  /** Reply: the stored values for these keys, with the defaults for any not stored. */
  | { type: 'storage.get'; area: StorageArea; defaults: Record<string, unknown> }
  /** Store these values. Reply: { ok: true }. The app then sends storage.changed to every page. */
  | { type: 'storage.set'; area: StorageArea; values: Record<string, unknown> }
  /** Make an HTTP request, adding the token named by request.auth. Reply: HttpResponse. */
  | { type: 'http'; request: HttpRequest }
  /** An app message (above) that filter.js doesn't handle itself. Reply: that message's reply. */
  | { type: 'message'; message: WorthwhileMessage }
  /** Development builds only: a log line. No reply needed. */
  | { type: 'log'; level: 'debug' | 'warn' | 'error'; text: string };

export type BridgeReply = Record<string, unknown> | HttpResponse | { ok: true };

// ---------------------------------------------------------------------------
// 3. App -> filter.js (iOS)
// ---------------------------------------------------------------------------
// window.__worthwhile.receive(message) returns the reply directly, so the
// app gets it as evaluateJavaScript's result.

export type AppToPageMessage =
  /** Stored values changed (e.g. the user edited a setting in the app). Returns { ok: true }. */
  | { type: 'storage.changed'; area: StorageArea; changes: StorageChanges }
  /** Returns the current session's receipt: ReceiptCounts (contracts/events.ts). */
  | { type: 'receipt.request' };
