// core/profile.ts
//
// The taste profile (contracts/taste-profile.ts): validating it, loading it
// from the website, falling back to a local one, and turning it into the
// profile the scoring server (the Worker) takes.
//
// Where a profile comes from:
//   - signed in to the website (an 'authToken' in local storage): fetched
//     from GET <profileUrl> with that token as a bearer token, validated,
//     and cached for PROFILE_CACHE_MS;
//   - signed out, or the website's copy is missing or invalid: the local
//     fallback. In the Chrome extension that's built from the extension's
//     own settings (rubric and interests), so scoring is exactly as before.
// Fail safe: an invalid profile is never used. Worthwhile then filters with
// the fallback, which never hides more than it did before.

import { tasteProfileSchema, type TasteProfile } from '../contracts/taste-profile';
import type { ProfileReply } from '../contracts/messages';
import type { HttpClient, Storage } from './interfaces';
import { validateJson, type JsonSchema } from './json-schema';
import { correctionExamples, DEFAULT_SETTINGS, type Correction, type Settings } from './settings';

export const PROFILE_CACHE_MS = 10 * 60 * 1000;

/** The Worker's limits (worker/src/index.js LIMITS), so a composed profile is never rejected. */
const SERVER_LIMITS = { rubric: 5000, interests: 30, interest: 80 };

export type ProfileCheck = { ok: true; profile: TasteProfile } | { ok: false; errors: string[] };

export function validateTasteProfile(value: unknown): ProfileCheck {
  const errors = validateJson(value, tasteProfileSchema as JsonSchema);
  return errors.length ? { ok: false, errors } : { ok: true, profile: value as TasteProfile };
}

/** The local default: Worthwhile's default rubric, no interests, no extra rules. */
export const DEFAULT_TASTE_PROFILE: TasteProfile = {
  interests: [],
  always_hide: [],
  shorts_policy: { allow: [], hide: [] },
  quality_bar: DEFAULT_SETTINGS.rubric,
  respected_creators: [],
};

/**
 * The local profile from the extension's own settings: the rubric becomes
 * quality_bar and each interest a topic (weight 3, intermediate). No extra
 * rules, so decisions are exactly what they were before taste profiles.
 */
export function profileFromSettings(settings: Pick<Settings, 'rubric' | 'interests'>): TasteProfile {
  return {
    interests: settings.interests.map((topic) => ({ topic, weight: 3, depth: 'intermediate' })),
    always_hide: [],
    shorts_policy: { allow: [], hide: [] },
    quality_bar: settings.rubric,
    respected_creators: [],
  };
}

/** What the Worker's /score, /score-shorts and /source take as "profile". */
export interface ServerProfile {
  rubric: string;
  interests: string[];
  rule: Settings['rule'];
  strictness: number;
  examples: { title: string; channel: string; verdict: 'show' | 'hide' }[];
}

/**
 * The profile sent to the Worker. From the fallback (the user's own
 * settings) it's exactly what the extension always sent. From a website
 * profile, quality_bar and its rules are written into the rubric, and the
 * interests go heaviest first.
 */
export function toServerProfile(
  loaded: ProfileReply,
  settings: Pick<Settings, 'rubric' | 'interests' | 'rule' | 'strictness'>,
  corrections: Correction[],
): ServerProfile {
  const examples = correctionExamples(corrections);
  if (loaded.source === 'fallback') {
    return { rubric: settings.rubric, interests: settings.interests, rule: settings.rule, strictness: settings.strictness, examples };
  }
  const taste = loaded.profile;
  const interests = [...taste.interests]
    .sort((a, b) => b.weight - a.weight)
    .map((i) => (i.depth === 'intermediate' ? i.topic : `${i.topic} (${i.depth})`).slice(0, SERVER_LIMITS.interest))
    .slice(0, SERVER_LIMITS.interests);
  return { rubric: composeRubric(taste), interests, rule: settings.rule, strictness: settings.strictness, examples };
}

/** quality_bar plus the profile's rules, in words the scoring prompt can use. */
export function composeRubric(taste: TasteProfile): string {
  const lines = [taste.quality_bar.trim() || DEFAULT_SETTINGS.rubric];
  const list = (items: string[]) => items.map((s) => s.trim()).filter(Boolean).join('; ');
  if (list(taste.always_hide)) lines.push(`Always hide: ${list(taste.always_hide)}.`);
  if (list(taste.respected_creators)) lines.push(`Channels I respect (not bait): ${list(taste.respected_creators)}.`);
  if (list(taste.shorts_policy.allow)) lines.push(`Shorts I want: ${list(taste.shorts_policy.allow)}.`);
  if (list(taste.shorts_policy.hide)) lines.push(`Shorts to hide: ${list(taste.shorts_policy.hide)}.`);
  return lines.join('\n').slice(0, SERVER_LIMITS.rubric);
}

interface CachedProfile {
  profile: TasteProfile;
  fetchedAt: number;
}

export interface LoadProfileOptions {
  /** Where 'authToken' (the website session) and the cached copy live. */
  storage: Storage;
  http: HttpClient;
  /** e.g. https://worthwhile.app/api/taste-profile. No URL: always the fallback. */
  profileUrl: string;
  /** Used when signed out or when the website's copy can't be used. */
  fallback: TasteProfile;
  now?: () => number;
  /** Told why a website profile was rejected (for logs). */
  onInvalid?: (errors: string[]) => void;
}

export async function loadTasteProfile(options: LoadProfileOptions): Promise<ProfileReply> {
  const { storage, http, profileUrl, fallback, onInvalid } = options;
  const now = (options.now || Date.now)();
  const { authToken, tasteProfileCache } = await storage.get({ authToken: '', tasteProfileCache: null as CachedProfile | null });
  const fallbackReply: ProfileReply = { profile: fallback, source: 'fallback' };
  if (!authToken || !profileUrl) return fallbackReply;

  // A cached copy is only used if it's still valid (the schema may have changed since).
  const cached = tasteProfileCache && validateTasteProfile(tasteProfileCache.profile).ok ? tasteProfileCache : null;
  if (cached && now - cached.fetchedAt < PROFILE_CACHE_MS) return { profile: cached.profile, source: 'cache' };

  const response = await http.request({ method: 'GET', url: profileUrl, auth: 'account', timeoutMs: 10000 });
  if ('status' in response && response.status === 200) {
    const check = validateTasteProfile(response.body);
    if (check.ok) {
      await storage.set({ tasteProfileCache: { profile: check.profile, fetchedAt: now } });
      return { profile: check.profile, source: 'server' };
    }
    onInvalid?.(check.errors);
    return fallbackReply; // fail safe: never filter by a profile that doesn't match the contract
  }
  // Network trouble or a server error: an older copy beats none.
  return cached ? { profile: cached.profile, source: 'cache' } : fallbackReply;
}
