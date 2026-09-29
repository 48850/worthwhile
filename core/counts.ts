// core/counts.ts
//
// Counts for the session record (M4), sent with the page's heartbeat. Each
// (kind, id) is counted once per page, so recycled cards aren't counted
// twice. Kinds: shown, hidden (home feed and sidebar), shortsSeen,
// shortsRemoved, corrections.

export type CountKind = 'shown' | 'hidden' | 'shortsSeen' | 'shortsRemoved' | 'corrections';

export const counts: Record<CountKind, number> = { shown: 0, hidden: 0, shortsSeen: 0, shortsRemoved: 0, corrections: 0 };
const counted = new Set<string>();

export function tally(kind: CountKind, id: string): void {
  const key = `${kind}:${id}`;
  if (counted.has(key)) return;
  counted.add(key);
  counts[kind]++;
}

/** The counts since the last call, and zeroes them (for the heartbeat). */
export function takeCounts(): Record<CountKind, number> {
  const taken = { ...counts };
  for (const kind of Object.keys(counts) as CountKind[]) counts[kind] = 0;
  return taken;
}
