// contracts/classification.ts
//
// What the server says about one video: the same for every user, so each
// video is classified once and cached for everyone. Nothing here depends on
// a taste profile; the extension works out relevance on the device
// (core/relevance.ts), so the profile never leaves it.

import type { InterestDepth } from './taste-profile';
import type { Format, JunkCategory } from './topics';

export interface VideoClassification {
  /** 0-1: substance, originality, honesty of title and thumbnail, craft. */
  quality: number;
  /** Why it's junk, or null. Junk is cut at every Range setting. */
  junk: JunkCategory | null;
  /** 1-3 topic ids from contracts/topics.ts, most central first. */
  topics: string[];
  /** 0-4 short, specific tags in plain words, e.g. "endgames", "Kepler". */
  tags: string[];
  /** How much it assumes of the viewer. */
  depth: InterestDepth;
  format: Format;
  /** One line for the user: what the video is (or why it's junk). */
  reason: string;
}
