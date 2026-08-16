/**
 * Returns the chronologically latest of the given timestamps, preserving the original
 * string. The Kobo device resolves reading-state conflicts on the envelope LastModified/
 * PriorityTimestamp, so these must never regress below the bookmark they wrap: a device
 * re-push of its older state must not lower an envelope that already carries a newer
 * hub-refreshed bookmark, or the device keeps rejecting the hub progress forever.
 */
export function maxIsoTimestamp(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = value;
  }
  return best;
}

/**
 * Returns an ISO timestamp strictly newer than every prior value, starting from `now`.
 *
 * Hub-side writes cannot simply stamp `now`: Kobo devices report their own clock, which
 * routinely runs ahead of the server, and that timestamp is stored verbatim. A hub update
 * stamped behind the state the device already holds loses the device's own conflict check,
 * so the device keeps its stale bookmark and pushes it back on the next sync.
 */
export function advanceIsoTimestamp(now: Date, ...priorValues: (string | null | undefined)[]): string {
  let ms = now.getTime();
  if (Number.isNaN(ms)) ms = Date.now();
  for (const value of priorValues) {
    if (!value) continue;
    const priorMs = new Date(value).getTime();
    if (Number.isNaN(priorMs) || priorMs < ms) continue;
    ms = priorMs + 1;
  }
  return new Date(ms).toISOString();
}
