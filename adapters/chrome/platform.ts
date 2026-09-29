// adapters/chrome/platform.ts
//
// core's interfaces, implemented with Chrome extension APIs. The only
// place (with background.ts and the ui/ pages) that touches chrome.*.
/// <reference types="chrome" />

import type { WorthwhileMessage } from '../../contracts/messages';
import type { HttpClient, HttpRequest, HttpResponse, Messaging, Storage, StorageChanges } from '../../core/interfaces';

/** chrome.storage.sync ('sync': settings), .local ('local': this device only) or .session ('session': until the browser closes). */
export class ChromeStorage implements Storage {
  constructor(private area: 'sync' | 'local' | 'session') {}

  get<T extends object>(defaults: T): Promise<T> {
    return chrome.storage[this.area].get<any>(defaults) as Promise<T>;
  }

  set(values: Record<string, unknown>): Promise<void> {
    return chrome.storage[this.area].set(values);
  }

  onChanged(listener: (changes: StorageChanges) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === this.area) listener(changes);
    });
  }
}

/** chrome.runtime messages: content scripts and pages -> the background worker. */
export class ChromeMessaging implements Messaging {
  send<R = unknown>(message: WorthwhileMessage): Promise<R> {
    return chrome.runtime.sendMessage(message) as Promise<R>;
  }

  onMessage(handler: (message: WorthwhileMessage) => unknown): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      let result: unknown;
      try {
        result = handler(message);
      } catch (err) {
        result = Promise.reject(err);
      }
      if (result === undefined) return false;
      Promise.resolve(result).then(sendResponse, (err) => sendResponse({ error: 'network', detail: String(err?.message || err) }));
      return true; // keeps the message channel open for the async reply
    });
  }
}

/**
 * fetch, adding the token a request asks for: 'invite' (the invite token
 * from the options page, for the Worker) or 'account' (the website session,
 * 'authToken' in local storage). A missing token: { error: 'no-token' }.
 */
export class ChromeHttp implements HttpClient {
  constructor(private settings: Storage, private local: Storage) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const headers: Record<string, string> = {};
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.auth !== 'none') {
      const token =
        request.auth === 'invite'
          ? (await this.settings.get({ token: '' })).token
          : (await this.local.get({ authToken: '' })).authToken;
      if (!token) return { error: 'no-token' };
      headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (err: any) {
      return { error: 'network', detail: String(err?.message || err) };
    }
    // Only a successful reply's body is read (an unreadable one throws, as it always did).
    return { status: response.status, body: response.ok ? await response.json() : null };
  }
}
