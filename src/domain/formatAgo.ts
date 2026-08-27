/** Short relative time for the freshness indicator. Never returns NaN. */
export function formatAgo(fromIso: string, nowMs: number): string {
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) return 'unknown';

  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
