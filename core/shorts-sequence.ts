// core/shorts-sequence.ts
//
// YouTube's list of upcoming Shorts (the reel_watch_sequence response, or
// ytInitialReelWatchSequenceResponse on a full page load): reading it and
// taking Shorts out of it. Pure data work; the page code that intercepts
// the response lives with each site.

/** Never leave YouTube a list shorter than this. */
export const MIN_KEPT = 2;

export interface UpcomingShort {
  id: string;
  /** Only present for some entries. */
  title: string | null;
  channel: string | null;
}

/** The Shorts in the order YouTube will play them. Entries that aren't Shorts (e.g. ads without a videoId) are skipped. */
export function readShorts(data: any): UpcomingShort[] {
  const shorts: UpcomingShort[] = [];
  for (const entry of Array.isArray(data?.entries) ? data.entries : []) {
    const endpoint = entry?.command?.reelWatchEndpoint;
    if (!endpoint?.videoId) continue;
    const details = endpoint.unserializedPrefetchData?.playerResponse?.videoDetails;
    shorts.push({ id: endpoint.videoId, title: details?.title || null, channel: details?.author || null });
  }
  return shorts;
}

/**
 * The list without the Shorts in `remove`, and which were taken out; null if
 * nothing should change (nothing to remove, or too few would be left).
 * Everything else in the response is kept exactly as YouTube sent it.
 */
export function withoutShorts(data: any, remove: Set<string>): { data: any; removed: string[] } | null {
  if (!remove.size || !Array.isArray(data?.entries)) return null;
  const entries = data.entries.filter((entry: any) => !remove.has(entry?.command?.reelWatchEndpoint?.videoId));
  if (entries.length < MIN_KEPT) return null;
  const removed = readShorts(data)
    .map((s) => s.id)
    .filter((id) => remove.has(id));
  return { data: { ...data, entries }, removed };
}
