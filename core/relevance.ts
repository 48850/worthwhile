// core/relevance.ts
//
// From the server's classification (the same for everyone) to this user's
// decision, on the device: the taste profile never leaves it.
//
//   relevance  0-1: how squarely a video fits the user's interests (topic
//              match, weighted by how much they want the interest and how
//              close its depth is to theirs).
//   fit        relevance, or for a video outside the user's interests, how
//              good it is (appeal(): from 0 at the quality floor up to just
//              under what Range 0 needs, so "Only my interests" stays that).
//   Range      0-1, the user's one control. 0 = "Only my interests",
//              1 = "Anything good". It moves the fit needed to be shown, and
//              nothing else. Sliding right first lets in the excellent from
//              outside the user's interests, then the good, and at the end
//              anything above the floor (light, funny, trending).
//   quality    the floor is fixed at every Range: junk and anything below
//              QUALITY_FLOOR never come back.
// Why fit and not relevance alone: in the eval (2026-10-14) the user's
// verdicts followed quality more than topic; good history, geography and
// tech videos outside their saved interests were all "show". DECISIONS.md.
//
// The order, first that applies wins (judge()):
//   1. a channel the user loves: shown (respected_creators: "never hidden");
//   2. no classification yet: shown (fail open; the caller decides how long
//      to wait first);
//   3. junk: cut;  4. below the quality floor: cut;
//   5. one of the user's exclusions (or, for Shorts, shorts_policy.hide): cut;
//   6. Shorts the user always wants (shorts_policy.allow), or fit at least
//      fitNeeded(range): shown;
//   7. otherwise: cut, as outside the Range.

import type { VideoClassification } from '../contracts/classification';
import type { InterestDepth, TasteInterest, TasteProfile } from '../contracts/taste-profile';
import {
  FORMAT_ALIASES,
  FORMATS,
  JUNK,
  JUNK_ALIASES,
  normaliseWords,
  TOPIC_GROUPS,
  TOPICS,
  type Format,
  type JunkCategory,
} from '../contracts/topics';

/** Cut below this quality at every Range. Set from the eval (DECISIONS.md). */
export const QUALITY_FLOOR = 0.4;
/** Where Range starts: near "Only my interests". */
export const DEFAULT_RANGE = 0.25;
/** The fit needed at Range 0. At Range 1 it's 0: anything above the floor. */
export const MAX_FIT_NEEDED = 0.6;
/** The most a video outside the user's interests can score on quality alone: just under MAX_FIT_NEEDED. */
export const MAX_APPEAL = 0.55;

const DEPTHS: InterestDepth[] = ['intro', 'intermediate', 'deep'];

/** The fit a video needs to be shown at this Range. */
export function fitNeeded(range: number): number {
  return MAX_FIT_NEEDED * (1 - Math.min(1, Math.max(0, range)));
}

/** A video's fit on quality alone: 0 at the floor, maxAppeal at quality 1. */
export function appeal(quality: number, floor = QUALITY_FLOOR, maxAppeal = MAX_APPEAL): number {
  if (quality < floor || floor >= 1) return 0;
  return (maxAppeal * (quality - floor)) / (1 - floor);
}

/** In the user's words, for the cut log and "why this is here". */
export const JUNK_LABELS: Record<JunkCategory, string> = {
  ragebait: 'Ragebait',
  engagement_bait: 'Engagement bait',
  ai_slop: 'AI slop',
  repost_farm: 'Reposted clips',
  reaction_farm: 'Reaction farm',
  misleading_clickbait: 'Misleading clickbait',
  scam_or_gambling: 'Scam or gambling promotion',
  drama_farming: 'Drama farming',
};

// ---------------------------------------------------------------------------
// Preparing a profile (once per profile change, not per video)
// ---------------------------------------------------------------------------

interface ResolvedInterest {
  interest: TasteInterest;
  /** Topics the interest names directly ("chess", "maths"). */
  topics: Set<string>;
  /** Topics in a group the interest names ("science"). */
  groupTopics: Set<string>;
  /** The interest's own words, for a plain text match when no topic fits. */
  words: string;
}

interface ResolvedExclusion {
  term: string;
  junk: Set<JunkCategory>;
  formats: Set<Format>;
  topics: Set<string>;
  /** Plain words to find in the title, channel or tags (when the term names no known category). */
  words: string | null;
}

export interface PreparedProfile {
  interests: ResolvedInterest[];
  exclusions: ResolvedExclusion[];
  shortsHide: ResolvedExclusion[];
  shortsAllow: ResolvedExclusion[];
  loved: Set<string>;
}

export function prepareProfile(taste: TasteProfile): PreparedProfile {
  return {
    interests: taste.interests.map(resolveInterest),
    exclusions: taste.always_hide.flatMap(resolveTerms),
    shortsHide: taste.shorts_policy.hide.flatMap(resolveTerms),
    shortsAllow: taste.shorts_policy.allow.flatMap(resolveTerms),
    loved: new Set(taste.respected_creators.map(channelKey).filter(Boolean)),
  };
}

function resolveInterest(interest: TasteInterest): ResolvedInterest {
  const words = normaliseWords(interest.topic);
  const topics = new Set<string>();
  const groupTopics = new Set<string>();
  for (const topic of TOPICS) {
    const names = [topic.id.replace(/-/g, ' '), normaliseWords(topic.label), ...topic.aliases];
    // Exact ("chess"), or the interest contains the name ("rook endgames in chess").
    if (names.some((name) => name === words || containsPhrase(words, name))) topics.add(topic.id);
  }
  for (const group of TOPIC_GROUPS) {
    if ([normaliseWords(group.label), ...group.aliases].includes(words)) {
      for (const topic of TOPICS) if (topic.group === group.id && !topics.has(topic.id)) groupTopics.add(topic.id);
    }
  }
  return { interest, topics, groupTopics, words };
}

// An exclusion may list several things: "hustle/motivation/get-rich content".
function resolveTerms(term: string): ResolvedExclusion[] {
  return term
    .split(/[,/;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => resolveExclusion(part, term));
}

const FILLER = /\s+(content|videos?|channels?|stuff|clips?)$/;

function resolveExclusion(part: string, term: string): ResolvedExclusion {
  const exact = normaliseWords(part);
  const candidates = [...new Set([exact, exact.replace(FILLER, '')])].filter(Boolean);
  const junk = new Set<JunkCategory>(JUNK.filter((j) => [j.replace(/_/g, ' '), ...JUNK_ALIASES[j]].some((a) => candidates.includes(a))));
  const formats = new Set<Format>(
    FORMATS.filter((f) => [f.replace(/-/g, ' '), ...(FORMAT_ALIASES[f] || [])].some((a) => candidates.includes(a))),
  );
  const topics = new Set<string>(
    TOPICS.filter((t) => [t.id.replace(/-/g, ' '), normaliseWords(t.label), ...t.aliases].some((a) => candidates.includes(a))).map((t) => t.id),
  );
  const known = junk.size + formats.size + topics.size > 0;
  return { term, junk, formats, topics, words: known ? null : exact };
}

// ---------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------

export interface RelevanceResult {
  score: number;
  /** The interest it matched best, if any. */
  interest: TasteInterest | null;
}

export function relevance(c: VideoClassification, text: { title: string; channel: string }, profile: PreparedProfile): RelevanceResult {
  const haystack = normaliseWords(`${text.title} ${c.tags.join(' ')}`);
  let best: RelevanceResult = { score: 0, interest: null };
  for (const resolved of profile.interests) {
    const score = topicMatch(c, haystack, resolved) * depthFactor(c.depth, resolved.interest.depth) * weightFactor(resolved.interest.weight);
    if (score > best.score) best = { score, interest: resolved.interest };
  }
  return best;
}

// 1 for the video's main topic, 0.85 for a secondary one; 0.8 of that when
// the interest names the topic's group; 0.6 for the interest's words in the
// title or tags when no topic fits.
function topicMatch(c: VideoClassification, haystack: string, resolved: ResolvedInterest): number {
  let score = 0;
  c.topics.forEach((topic, i) => {
    const position = i === 0 ? 1 : 0.85;
    if (resolved.topics.has(topic)) score = Math.max(score, position);
    else if (resolved.groupTopics.has(topic)) score = Math.max(score, 0.8 * position);
  });
  if (score === 0 && resolved.words && containsPhrase(haystack, resolved.words)) score = 0.6;
  return score;
}

function depthFactor(video: InterestDepth, wanted: InterestDepth): number {
  const gap = Math.abs(DEPTHS.indexOf(video) - DEPTHS.indexOf(wanted));
  return [1, 0.9, 0.75][gap] ?? 0.75;
}

// Weight 1 (a little) to 5 (a lot): 0.7 to 1.
function weightFactor(weight: number): number {
  return 0.7 + (0.3 * (Math.min(5, Math.max(1, weight)) - 1)) / 4;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type VerdictReason =
  | 'loved-creator'
  | 'unclassified'
  | 'junk'
  | 'below-floor'
  | 'excluded'
  | 'shorts-allowed'
  | 'in-range' // on one of the user's interests
  | 'good-enough' // outside their interests, but good enough for their Range
  | 'off-range';

export interface ItemVerdict {
  action: 'show' | 'cut';
  reason: VerdictReason;
  relevance: number;
  /** max(relevance, appeal): what Range compares. */
  fit: number;
  /** The exclusion or interest behind the decision, in the user's own words. */
  matched: string | null;
}

export interface JudgeInput {
  item: { title: string; channel: string; isShort: boolean };
  classification: VideoClassification | null | undefined;
  profile: PreparedProfile;
  range: number;
  /** Only the eval harness changes these (to choose QUALITY_FLOOR and MAX_APPEAL). */
  floor?: number;
  maxAppeal?: number;
}

export function judge({ item, classification: c, profile, range, floor = QUALITY_FLOOR, maxAppeal = MAX_APPEAL }: JudgeInput): ItemVerdict {
  const none = { relevance: 0, fit: 0, matched: null };
  if (item.channel && profile.loved.has(channelKey(item.channel))) return { action: 'show', reason: 'loved-creator', relevance: 1, fit: 1, matched: item.channel };
  if (!c) return { action: 'show', reason: 'unclassified', ...none };
  if (c.junk) return { action: 'cut', reason: 'junk', ...none };
  if (c.quality < floor) return { action: 'cut', reason: 'below-floor', ...none };

  const exclusions = item.isShort ? [...profile.exclusions, ...profile.shortsHide] : profile.exclusions;
  const excludedBy = exclusions.find((e) => excludes(e, c, item));
  if (excludedBy) return { action: 'cut', reason: 'excluded', ...none, matched: excludedBy.term };

  const rel = relevance(c, item, profile);
  const scores = { relevance: rel.score, fit: Math.max(rel.score, appeal(c.quality, floor, maxAppeal)) };
  if (item.isShort) {
    const allowedBy = profile.shortsAllow.find((e) => excludes(e, c, item));
    if (allowedBy) return { action: 'show', reason: 'shorts-allowed', ...scores, matched: allowedBy.term };
  }
  const needed = fitNeeded(range);
  if (rel.score > 0 && rel.score >= needed) return { action: 'show', reason: 'in-range', ...scores, matched: rel.interest?.topic ?? null };
  if (scores.fit >= needed) return { action: 'show', reason: 'good-enough', ...scores, matched: null };
  return { action: 'cut', reason: 'off-range', ...scores, matched: rel.interest?.topic ?? null };
}

// Whether an exclusion (or a Shorts allow/hide term) describes this video.
function excludes(e: ResolvedExclusion, c: VideoClassification, item: { title: string; channel: string }): boolean {
  if (c.junk && e.junk.has(c.junk)) return true;
  if (e.formats.has(c.format)) return true;
  if (c.topics.some((t) => e.topics.has(t))) return true;
  return e.words != null && containsPhrase(normaliseWords(`${item.title} ${item.channel} ${c.tags.join(' ')}`), e.words);
}

/** "Why this is here" (or why it was cut), in one line. */
export function whyLine(verdict: ItemVerdict, c: VideoClassification | null | undefined): string {
  const what = c?.reason || '';
  switch (verdict.reason) {
    case 'loved-creator':
      return `From ${verdict.matched}, a channel you love.`;
    case 'unclassified':
      return 'Not checked yet, so it’s shown.';
    case 'junk':
      return `${c ? JUNK_LABELS[c.junk!] : 'Junk'}: ${what}`;
    case 'below-floor':
      return `Low effort: ${what}`;
    case 'excluded':
      return `You skip ${verdict.matched}: ${what}`;
    case 'shorts-allowed':
      return `Shorts you always want (${verdict.matched}): ${what}`;
    case 'in-range':
      return `${capitalise(verdict.matched || 'your interests')}: ${what}`;
    case 'good-enough':
      return `Outside your interests, but good: ${what}`;
    case 'off-range':
      return `Outside your Range: ${what}`;
  }
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase !== '' && ` ${haystack} `.includes(` ${phrase} `);
}

function channelKey(name: string): string {
  return normaliseWords(name.replace(/^@/, ''));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
