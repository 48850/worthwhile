// core/util.ts
//
// Small helpers with no host dependency (timers are fine everywhere).

/** Resolves with find()'s first truthy result, or null after timeoutMs. */
export function waitFor<T>(find: () => T | null | undefined | false, timeoutMs: number, intervalMs = 200): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const found = find();
      if (found || Date.now() - start > timeoutMs) resolve(found || null);
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 1234567 -> "1.2M views", like YouTube. '' if unknown. */
export function formatViews(count: number | null | undefined): string {
  const n = Number(count);
  if (!Number.isFinite(n) || count == null) return '';
  if (n < 1000) return `${n} view${n === 1 ? '' : 's'}`;
  const [value, unit] = n < 1e6 ? [n / 1e3, 'K'] : n < 1e9 ? [n / 1e6, 'M'] : [n / 1e9, 'B'];
  return `${value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)}${unit} views`;
}

/** ISO date -> "3 days ago", like YouTube. '' if unknown. */
export function formatAgo(iso: string | null | undefined): string {
  const seconds = (Date.now() - Date.parse(iso as string)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const units: [string, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

/** A YouTube video ID. */
export const VIDEO_ID = /^[\w-]{11}$/;
