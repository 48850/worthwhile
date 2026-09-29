// core/classifier.ts
//
// Talking to the scoring server (the Worker at API_BASE_URL):
//   postToServer   one POST, with the error handling the extension has
//                  always had (no token / bad token / offline -> { error })
//   HttpClassifier the Classifier for code that calls the server itself
//                  (Chrome: the background worker; iOS: filter.js, through
//                  the app's HTTP bridge)
//   MessagingClassifier the Classifier for code that asks someone else to
//                  (Chrome: content scripts ask the background worker)
// Any error means every item is shown (the callers' fail-safe rule).

import type { Classifier, HttpClient, Messaging } from './interfaces';
import type { ClassifyError, ClassifyResult, Classification, FeedItem } from './types';
import type { ServerProfile } from './profile';

export const TIMEOUT_MS = 30000;
export const SOURCE_TIMEOUT_MS = 60000; // sourcing may fetch from YouTube and score dozens of videos

/** 'ok' | 'offline' | 'bad-token' | 'no-token': shown on the toolbar icon and in the popup. */
export type ServerStatus = 'ok' | 'offline' | 'bad-token' | 'no-token' | 'unknown';

export interface ServerDeps {
  http: HttpClient;
  apiBaseUrl: string;
  /** Told the outcome of every request, so failing open is never silent. */
  onStatus?: (status: ServerStatus) => Promise<void> | void;
}

/**
 * POSTs JSON to the server with the invite token. Returns the server's JSON
 * reply, or { error, detail? }: 'no-token', 'network', 'bad-token' (401) or
 * 'server' (any other non-2xx).
 */
export async function postToServer(deps: ServerDeps, path: string, body: unknown, timeoutMs: number): Promise<any> {
  const response = await deps.http.request({ method: 'POST', url: `${deps.apiBaseUrl}${path}`, body, auth: 'invite', timeoutMs });
  if ('error' in response) {
    if (response.error === 'no-token') {
      await deps.onStatus?.('no-token');
      return { error: 'no-token' };
    }
    await deps.onStatus?.('offline');
    return { error: 'network', detail: response.detail };
  }
  if (response.status === 401) {
    await deps.onStatus?.('bad-token');
    return { error: 'bad-token' };
  }
  if (response.status < 200 || response.status >= 300) {
    await deps.onStatus?.('offline');
    return { error: 'server', detail: `HTTP ${response.status}` };
  }
  await deps.onStatus?.('ok');
  return response.body;
}

/** The server's { results: { id: { verdict, scores } } } reply (or an error) as a ClassifyResult. */
export function toClassifyResult(reply: any): ClassifyResult {
  const results = reply && reply.results;
  if (!results || typeof results !== 'object') {
    const known: ClassifyError[] = ['no-token', 'bad-token', 'network', 'server', 'extension-reloaded'];
    return { error: known.includes(reply?.error) ? reply.error : 'server' };
  }
  const decisions: Record<string, Classification> = {};
  for (const [id, result] of Object.entries<any>(results)) {
    if (result && (result.verdict === 'show' || result.verdict === 'hide')) {
      decisions[id] = { verdict: result.verdict, scores: result.scores || null };
    }
  }
  return { decisions };
}

export class HttpClassifier implements Classifier {
  constructor(
    private deps: ServerDeps,
    /** The server profile to send, built fresh for each request (settings may have changed). */
    private profile: () => Promise<ServerProfile>,
  ) {}

  async classify(items: FeedItem[]): Promise<ClassifyResult> {
    const body = { profile: await this.profile(), items: items.map(({ id, title, channel, duration }) => ({ id, title, channel, duration })) };
    return toClassifyResult(await postToServer(this.deps, '/score', body, TIMEOUT_MS));
  }

  async classifyShorts(ids: string[]): Promise<ClassifyResult> {
    return toClassifyResult(await postToServer(this.deps, '/score-shorts', { profile: await this.profile(), ids }, TIMEOUT_MS));
  }
}

export class MessagingClassifier implements Classifier {
  constructor(private messaging: Messaging) {}

  async classify(items: FeedItem[]): Promise<ClassifyResult> {
    const scoreItems = items.map(({ id, title, channel, duration }) => ({ id, title, channel, duration }));
    return toClassifyResult(await this.ask({ type: 'score', items: scoreItems }));
  }

  async classifyShorts(ids: string[]): Promise<ClassifyResult> {
    return toClassifyResult(await this.ask({ type: 'scoreShorts', ids }));
  }

  // A page whose script outlived an extension update can't reach the background any more.
  private async ask(message: Parameters<Messaging['send']>[0]): Promise<any> {
    try {
      return await this.messaging.send(message);
    } catch {
      return { error: 'extension-reloaded' };
    }
  }
}
