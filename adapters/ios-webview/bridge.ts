// adapters/ios-webview/bridge.ts
//
// The one channel between filter.js and the iOS app.
//   filter.js -> app: window.webkit.messageHandlers.worthwhile.postMessage(msg)
//     returns a Promise of the app's reply (the app registers the handler
//     with WKScriptMessageHandlerWithReply).
//   app -> filter.js: the app calls window.__worthwhile.receive(msg) with
//     evaluateJavaScript; its return value is the reply.
//   config: window.__WORTHWHILE_CONFIG__, set by an earlier WKUserScript.
// Messages: contracts/messages.ts (BridgeMessage, AppToPageMessage).

import type { AppToPageMessage, BridgeMessage } from '../../contracts/messages';
import type { WorthwhileConfig } from '../../core/config';

/** What the app passes in before filter.js runs. */
export interface IosConfig extends WorthwhileConfig {
  /** Settings to use as defaults (the app's own UI owns them; stored values win). */
  settings?: Record<string, unknown>;
  /** The user's taste profile, fetched by the app from the website. Validated before use. */
  profile?: unknown;
}

interface WebkitHandler {
  postMessage(message: BridgeMessage): Promise<any>;
}

function handler(): WebkitHandler | null {
  return (window as any).webkit?.messageHandlers?.worthwhile ?? null;
}

/** Whether filter.js is running inside the app (false in a plain browser, e.g. while testing). */
export function hasBridge(): boolean {
  return handler() !== null;
}

/** Sends a message to the app and resolves with its reply. Rejects outside the app. */
export async function toApp<R = any>(message: BridgeMessage): Promise<R> {
  const h = handler();
  if (!h) throw new Error('Worthwhile: not running inside the app (no webkit message handler)');
  return h.postMessage(message);
}

export function readConfig(): IosConfig | null {
  const config = (window as any).__WORTHWHILE_CONFIG__;
  return config && typeof config.apiBaseUrl === 'string' && config.apiBaseUrl ? (config as IosConfig) : null;
}

type Receiver = (message: AppToPageMessage) => unknown;
const receivers: Receiver[] = [];

/** Listen for messages from the app; the first receiver to return a value provides the reply. */
export function onAppMessage(receiver: Receiver): void {
  receivers.push(receiver);
}

// window.__worthwhile.receive(message): the app's way in.
Object.defineProperty(window, '__worthwhile', {
  value: Object.freeze({
    receive(message: AppToPageMessage): unknown {
      for (const receiver of receivers) {
        const reply = receiver(message);
        if (reply !== undefined) return reply;
      }
      return { ok: false, error: 'unknown message' };
    },
  }),
  configurable: false,
});
