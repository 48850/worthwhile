// core/settings.ts
//
// The settings every part of Worthwhile shares, with their defaults, and the
// things remembered on this device only. Chrome keeps settings in
// chrome.storage.sync (they follow the user between their own Chrome/Edge
// installs) and the rest in chrome.storage.local; iOS keeps both in the app.
// Either way they arrive here as two Storage objects.

import type { Storage } from './interfaces';
import type { Scores, Verdict } from './types';

export interface Settings {
  enabled: boolean;
  /** Invite token, entered on the options page. */
  token: string;
  rubric: string;
  /** Edited in the toolbar popup. */
  interests: string[];
  /** 'bait': hide clear bait only (default). 'strict': the original rule, uses strictness. */
  rule: 'bait' | 'strict';
  /** Strict rule only: 1 (lenient) to 5 (strict). 2 passed the M1 holdout test. */
  strictness: number;
  /** Label bait Shorts (never skips); off by default. */
  shortsLabels: boolean;
  /**
   * Remove clear bait from YouTube's list of upcoming Shorts, so it never
   * appears (bait score >= shortsRemoveLevel). 8 hid none of 40 good Shorts
   * in testing (2026-09-26); 6 hid about 1 in 6.
   */
  shortsRemove: boolean;
  shortsRemoveLevel: number;
  /** Hide the Shorts shelf on the home page: titles too thin to score, mostly slop. */
  hideShortsShelf: boolean;
  /** Channel names hidden outright by "Hide channel", no model involved. */
  hiddenChannels: string[];
  /** Record Shorts as the user swipes, to build a labelled test set. */
  collectShorts: boolean;
  /**
   * Commitment lock (M4): switching the filter on keeps it on for LOCK_DAYS.
   * Switching off before then takes a 60-second wait and a typed reason
   * (popup). Unix ms; 0 = not locked.
   */
  lockedUntil: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  token: '',
  rubric:
    "Worthwhile means I come away understanding, knowing or appreciating something I didn't before. " +
    'Prefer depth over hype: explanations, analysis, craft, real expertise, full performances. ' +
    "Prefer independent and niche creators over mass-market channels. Humour is fine if it's clever. " +
    'Hide ragebait, drama and gossip, reaction videos, clickbait titles that overpromise, AI-generated slop, ' +
    'hustle/motivation/get-rich content, generic top-10 lists, and mainstream hype.',
  interests: [],
  rule: 'bait',
  strictness: 2,
  shortsLabels: false,
  shortsRemove: true,
  shortsRemoveLevel: 8,
  hideShortsShelf: true,
  hiddenChannels: [],
  collectShorts: false,
  lockedUntil: 0,
};
export const LOCK_DAYS = 7;
export const MAX_HIDDEN_CHANNELS = 200;

export const SETTINGS_LIMITS = {
  interests: 20, // how many interests
  interestLength: 40, // characters per interest
  rubricLength: 2500, // characters; chrome.storage.sync allows about 8 KB per setting
};

export interface Correction {
  videoId: string;
  title: string;
  channel: string;
  scores: Partial<Scores> | null;
  verdict: Verdict;
  at?: number;
}

export interface OpenedChannel {
  id?: string;
  handle?: string;
  name?: string;
}

export interface CollectedShort {
  id: string;
  title: string;
  channel: string;
  queued: 'yes' | 'no' | 'unknown';
  lead?: number | null;
  ahead?: number;
  verdictReady?: boolean;
  at: number;
}

export interface RemovedShort {
  id: string;
  bait: number;
  at: number;
}

/**
 * Things remembered on this device only, never synced:
 *   openedChannels: channels of videos opened from the grid, newest first.
 *     Sourcing searches their latest uploads.
 *   notInterested: video IDs we told YouTube "Not interested" about.
 *   corrections: the user's "Show it anyway" / "Wrong call" clicks, newest
 *     first. The 10 newest go to the scoring prompt as labelled examples.
 *   worthOpen: whether the "Worth your time" row is expanded.
 *   collectedShorts: Shorts recorded by "Collect Shorts" for the labelled test set.
 *   shortsToday: how many bait Shorts were removed today, for the popup.
 *   removedShorts: the most recently removed Shorts, so the user can check them (options page).
 */
export interface LocalData {
  openedChannels: OpenedChannel[];
  notInterested: string[];
  corrections: Correction[];
  worthOpen: boolean;
  collectedShorts: CollectedShort[];
  shortsToday: { day: string; removed: number };
  removedShorts: RemovedShort[];
}

export const LOCAL_DEFAULTS: LocalData = {
  openedChannels: [],
  notInterested: [],
  corrections: [],
  worthOpen: true,
  collectedShorts: [],
  shortsToday: { day: '', removed: 0 },
  removedShorts: [],
};
export const MAX_REMOVED_KEPT = 50;
export const MAX_OPENED_CHANNELS = 20;
export const MAX_NOT_INTERESTED = 1000;
export const MAX_CORRECTIONS = 20;
export const MAX_EXAMPLES_SENT = 10;

/** Today's date as YYYY-MM-DD, in local time. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The newest corrections as prompt examples: [{ title, channel, verdict }]. */
export function correctionExamples(corrections: Correction[]): { title: string; channel: string; verdict: Verdict }[] {
  return corrections.slice(0, MAX_EXAMPLES_SENT).map(({ title, channel, verdict }) => ({ title, channel, verdict }));
}

/** The settings (sync) and device-only (local) stores, with the helpers every part uses. */
export function createStores(settingsStore: Storage, localStore: Storage) {
  const loadSettings = (): Promise<Settings> => settingsStore.get({ ...DEFAULT_SETTINGS });
  const loadLocal = (): Promise<LocalData> => localStore.get({ ...LOCAL_DEFAULTS });

  // Today's count of removed Shorts (zero on a new day).
  async function loadShortsToday(): Promise<{ day: string; removed: number }> {
    const { shortsToday } = await loadLocal();
    return shortsToday.day === todayKey() ? shortsToday : { day: todayKey(), removed: 0 };
  }

  return {
    settingsStore,
    localStore,
    loadSettings,
    loadLocal,
    loadShortsToday,

    // Adds or removes a channel from the "Hide channel" list (matched by name, ignoring case).
    async setChannelHidden(name: string, hidden: boolean): Promise<void> {
      const { hiddenChannels } = await loadSettings();
      const others = hiddenChannels.filter((c) => c.toLowerCase() !== name.toLowerCase());
      await settingsStore.set({ hiddenChannels: hidden ? [name, ...others].slice(0, MAX_HIDDEN_CHANNELS) : others });
    },

    // Records Shorts removed from YouTube's list: [{ id, bait }].
    async rememberRemovedShorts(list: { id: string; bait: number }[]): Promise<void> {
      const [today, { removedShorts }] = await Promise.all([loadShortsToday(), loadLocal()]);
      const now = Date.now();
      const fresh = list.map((s) => ({ ...s, at: now }));
      await localStore.set({
        shortsToday: { ...today, removed: today.removed + list.length },
        removedShorts: [...fresh, ...removedShorts.filter((r) => !list.some((s) => s.id === r.id))].slice(0, MAX_REMOVED_KEPT),
      });
    },

    async rememberChannel(channel: OpenedChannel | null | undefined): Promise<void> {
      if (!channel || (!channel.id && !channel.handle)) return;
      const { openedChannels } = await loadLocal();
      const same = (c: OpenedChannel) => (channel.id && c.id === channel.id) || (channel.handle && c.handle === channel.handle);
      const next = [channel, ...openedChannels.filter((c) => !same(c))].slice(0, MAX_OPENED_CHANNELS);
      await localStore.set({ openedChannels: next });
    },

    async rememberNotInterested(videoId: string): Promise<void> {
      const { notInterested } = await loadLocal();
      if (notInterested.includes(videoId)) return;
      await localStore.set({ notInterested: [videoId, ...notInterested].slice(0, MAX_NOT_INTERESTED) });
    },

    // Records a correction; a newer one for the same video replaces the older.
    async rememberCorrection(correction: Correction): Promise<void> {
      const { corrections } = await loadLocal();
      const next = [{ ...correction, at: Date.now() }, ...corrections.filter((c) => c.videoId !== correction.videoId)];
      await localStore.set({ corrections: next.slice(0, MAX_CORRECTIONS) });
    },
  };
}

export type Stores = ReturnType<typeof createStores>;
