// core/host.ts
//
// The host side of every app message (contracts/messages.ts): scoring,
// sourcing, server checks, sessions, analytics events and the taste
// profile. The Chrome extension runs it in its background worker
// (adapters/chrome/background.ts); the iOS WebView runs it inside
// filter.js, since there's no background there (adapters/ios-webview).
// Only the platform bits differ, and they come in as deps.

import type { WorthwhileEvent } from '../contracts/events';
import type { ProfileReply, WorthwhileMessage } from '../contracts/messages';
import { postToServer, SOURCE_TIMEOUT_MS, TIMEOUT_MS, type ServerStatus } from './classifier';
import { profileUrlOf, type WorthwhileConfig } from './config';
import type { HttpClient, Storage } from './interfaces';
import { loadTasteProfile, profileFromSettings, toServerProfile, validateTasteProfile } from './profile';
import { createSessionTracker } from './session';
import type { Stores } from './settings';

const HEALTH_TIMEOUT_MS = 5000;

export interface HostDeps {
  stores: Stores;
  http: HttpClient;
  config: WorthwhileConfig;
  /** Where the last server status is kept (Chrome: chrome.storage.session). */
  statusStore: Storage;
  /** Called after every status change (Chrome: update the toolbar badge). */
  onStatusChange?: () => Promise<unknown> | unknown;
  /** Arrange for sessions.onSessionAlarm() to run at this time. */
  scheduleSessionEnd: (when: number) => void;
  /** Analytics events (from pages, and the host's own session events). */
  onEvents: (events: WorthwhileEvent[]) => void;
  /** A profile handed over by the app (iOS: __WORTHWHILE_CONFIG__.profile). Used if valid. */
  givenProfile?: () => unknown;
  log?: { warn: (...args: unknown[]) => void };
}

export function createHost(deps: HostDeps) {
  const { stores, http, config } = deps;
  const server = { http, apiBaseUrl: config.apiBaseUrl, onStatus: setServerStatus };

  const sessions = createSessionTracker({
    local: stores.localStore,
    loadSettings: stores.loadSettings,
    postSessions: (records) => postToServer(server, '/session', { sessions: records }, TIMEOUT_MS),
    scheduleEnd: deps.scheduleSessionEnd,
    emit: (event) => deps.onEvents([event]),
  });

  /** Handles one app message; undefined for messages it doesn't know. */
  function handle(message: WorthwhileMessage): Promise<unknown> | undefined {
    switch (message?.type) {
      case 'score':
        return scoreItems(message.items);
      case 'scoreShorts':
        return scoreShorts(message.ids);
      case 'source':
        return sourceItems();
      case 'checkServer':
        return checkServer();
      case 'activity':
        return sessions.onActivity(message);
      case 'fatigue':
        return sessions.onFatigue();
      case 'rate':
        return sessions.onRate(message);
      case 'events':
        deps.onEvents(Array.isArray(message.events) ? message.events : []);
        return Promise.resolve({ ok: true });
      case 'profile':
        return loadProfile();
      default:
        return undefined;
    }
  }

  // The taste profile: one the app handed over (if valid), else the
  // website's when signed in to it, else the user's own settings (exactly
  // what was always sent).
  async function loadProfile(): Promise<ProfileReply> {
    const given = deps.givenProfile?.();
    if (given != null) {
      const check = validateTasteProfile(given);
      if (check.ok) return { profile: check.profile, source: 'server' };
      deps.log?.warn('Worthwhile: the taste profile from the app is invalid, so it is not used:', check.errors);
    }
    const settings = await stores.loadSettings();
    return loadTasteProfile({
      storage: stores.localStore,
      http,
      profileUrl: config.profileUrl === '' ? '' : profileUrlOf(config),
      fallback: profileFromSettings(settings),
      onInvalid: (errors) => deps.log?.warn('Worthwhile: the website taste profile is invalid, so it is not used:', errors),
    });
  }

  // The profile sent with scoring requests. The user's newest corrections go
  // along as labelled examples; they're part of the prompt, so a new
  // correction re-scores (new cache key).
  async function serverProfile() {
    const [settings, { corrections }, loaded] = await Promise.all([stores.loadSettings(), stores.loadLocal(), loadProfile()]);
    return toServerProfile(loaded, settings, corrections);
  }

  // The Worker's reply ({ results: { videoId: { verdict, scores } } }) or
  // { error }. The page shows everything on any error.
  async function scoreItems(items: unknown) {
    return postToServer(server, '/score', { profile: await serverProfile(), items }, TIMEOUT_MS);
  }

  // Shorts by video ID (up to 20): the Worker looks up each one's details and
  // thumbnail itself. Same reply shape as /score.
  async function scoreShorts(ids: unknown) {
    return postToServer(server, '/score-shorts', { profile: await serverProfile(), ids }, TIMEOUT_MS);
  }

  // Approved videos from the user's interests and the channels they opened
  // (remembered on this device): { items } or { error }.
  async function sourceItems() {
    const { openedChannels } = await stores.loadLocal();
    const channels = openedChannels.slice(0, 20).map((c) => (c.id ? { id: c.id } : { handle: c.handle }));
    return postToServer(server, '/source', { profile: await serverProfile(), channels }, SOURCE_TIMEOUT_MS);
  }

  // Asked each time the popup opens, so its status is current.
  async function checkServer() {
    const { token } = await stores.loadSettings();
    if (!token) return setServerStatus('no-token');
    const response = await http.request({ method: 'GET', url: `${config.apiBaseUrl}/health`, auth: 'none', timeoutMs: HEALTH_TIMEOUT_MS }).catch(() => null);
    if (!response || 'error' in response) return setServerStatus('offline');
    const { serverStatus } = await deps.statusStore.get({ serverStatus: 'unknown' });
    // /health doesn't check the token, so keep a known "bad-token" until a real request succeeds.
    const ok = response.status >= 200 && response.status < 300;
    return setServerStatus(ok ? (serverStatus === 'bad-token' ? 'bad-token' : 'ok') : 'offline');
  }

  // serverStatus: 'ok' | 'offline' | 'bad-token' | 'no-token' | 'unknown'.
  async function setServerStatus(serverStatus: ServerStatus) {
    await deps.statusStore.set({ serverStatus });
    await deps.onStatusChange?.();
    return { serverStatus };
  }

  return { handle, sessions, loadProfile };
}

export type Host = ReturnType<typeof createHost>;
