// contracts/taste-profile.ts
//
// The taste profile the website (Lovable on Supabase) creates for each user
// and serves from its authenticated GET /api/taste-profile. This type and
// taste-profile.schema.json describe the same shape: change both together.
// core/profile.ts validates every profile it receives against the schema.

export type InterestDepth = 'intro' | 'intermediate' | 'deep';

export interface TasteInterest {
  topic: string;
  /** How much the user wants this topic, 1 (a little) to 5 (a lot). */
  weight: 1 | 2 | 3 | 4 | 5;
  depth: InterestDepth;
}

export interface TasteProfile {
  interests: TasteInterest[];
  /** Topics, formats or channels to hide whatever their score. */
  always_hide: string[];
  /** Kinds of Shorts to always keep or always remove. */
  shorts_policy: { allow: string[]; hide: string[] };
  /** The user's own words for what counts as worthwhile. */
  quality_bar: string;
  /** Channels whose videos are never hidden. */
  respected_creators: string[];
}

export { default as tasteProfileSchema } from './taste-profile.schema.json';
