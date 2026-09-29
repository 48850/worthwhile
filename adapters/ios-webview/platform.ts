// adapters/ios-webview/platform.ts
//
// core's interfaces for the iOS WebView, all through the app bridge:
//   IosStorage    storage.get / storage.set; changes arrive as
//                 storage.changed messages from the app
//   IosHttp       http: the app makes the request and adds the token
//                 (tokens never enter the page)
//   IosMessaging  app messages: handled right here by core's host (there's
//                 no background worker). Events reach the app from the
//                 host's onEvents (bootstrap.ts), so each is sent once.

import type { StorageArea, WorthwhileMessage } from '../../contracts/messages';
import type { HttpClient, HttpRequest, HttpResponse, Messaging, Storage, StorageChanges } from '../../core/interfaces';
import { onAppMessage, toApp } from './bridge';

export class IosStorage implements Storage {
  private listeners: ((changes: StorageChanges) => void)[] = [];

  /** defaults: values the app passed in __WORTHWHILE_CONFIG__ (stored values win). */
  constructor(
    private area: StorageArea,
    private given: Record<string, unknown> = {},
  ) {
    onAppMessage((message) => {
      if (message.type !== 'storage.changed' || message.area !== this.area) return undefined;
      this.listeners.forEach((l) => l(message.changes));
      return { ok: true };
    });
  }

  async get<T extends object>(defaults: T): Promise<T> {
    const withGiven = { ...defaults } as Record<string, unknown>;
    for (const key of Object.keys(defaults)) if (key in this.given) withGiven[key] = this.given[key];
    try {
      const stored = await toApp<Record<string, unknown>>({ type: 'storage.get', area: this.area, defaults: withGiven });
      return { ...withGiven, ...(stored || {}) } as T;
    } catch {
      return withGiven as T; // no app: the given values, or the defaults
    }
  }

  async set(values: Record<string, unknown>): Promise<void> {
    await toApp({ type: 'storage.set', area: this.area, values });
  }

  onChanged(listener: (changes: StorageChanges) => void): void {
    this.listeners.push(listener);
  }
}

export class IosHttp implements HttpClient {
  async request(request: HttpRequest): Promise<HttpResponse> {
    try {
      const reply = await toApp<HttpResponse>({ type: 'http', request });
      return reply && ('status' in reply || 'error' in reply) ? reply : { error: 'network', detail: 'no reply from the app' };
    } catch (err: any) {
      return { error: 'network', detail: String(err?.message || err) };
    }
  }
}

export class IosMessaging implements Messaging {
  private handlers: ((message: WorthwhileMessage) => unknown)[] = [];

  async send<R = unknown>(message: WorthwhileMessage): Promise<R> {
    for (const handler of this.handlers) {
      const reply = handler(message);
      if (reply !== undefined) return (await reply) as R;
    }
    throw new Error(`Worthwhile: nothing handles "${message.type}"`);
  }

  onMessage(handler: (message: WorthwhileMessage) => unknown): void {
    this.handlers.push(handler);
  }
}
