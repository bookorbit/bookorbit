import { buildSessionId } from '../../common/utils/koreader-session-id.utils';

export const KOREADER_SESSION_GAP_SECONDS = 1800;
/** Upper bound accepted for a single page event, used to bound backward window scans. */
export const KOREADER_MAX_EVENT_DURATION_SECONDS = 86400;
export const KOREADER_MIN_SESSION_SECONDS = 10;
export const KOREADER_BACKFILL_EVENT_THRESHOLD = 20;

export interface KoreaderPageEvent {
  page: number;
  startTime: number;
  durationSeconds: number;
  totalPages: number;
}

export interface DerivedKoreaderSession {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
}

export function clusterPageStats(events: KoreaderPageEvent[], gapSeconds: number = KOREADER_SESSION_GAP_SECONDS): KoreaderPageEvent[][] {
  const sorted = [...events].sort((a, b) => a.startTime - b.startTime || a.page - b.page);
  const clusters: KoreaderPageEvent[][] = [];
  let current: KoreaderPageEvent[] = [];
  let clusterEnd = 0;

  for (const event of sorted) {
    // A gap of exactly gapSeconds stays in the same cluster; only a strictly larger gap splits.
    if (current.length > 0 && event.startTime - clusterEnd > gapSeconds) {
      clusters.push(current);
      current = [];
    }
    current.push(event);
    clusterEnd = Math.max(clusterEnd, event.startTime + event.durationSeconds);
  }
  if (current.length > 0) clusters.push(current);

  return clusters;
}

export function computeClusterMetrics(cluster: KoreaderPageEvent[], deviceId: string, bookFileId: number): DerivedKoreaderSession {
  const first = cluster[0]!;
  let endEpoch = first.startTime;
  let durationSum = 0;
  let last = first;

  for (const event of cluster) {
    durationSum += event.durationSeconds;
    endEpoch = Math.max(endEpoch, event.startTime + event.durationSeconds);
    if (event.startTime >= last.startTime) last = event;
  }

  // Sum of page durations excludes idle gaps inside the cluster; the wall-clock cap keeps the
  // existing reading_sessions invariant that duration never exceeds endedAt - startedAt.
  const wallClockSeconds = endEpoch - first.startTime;
  const durationSeconds = Math.min(durationSum, wallClockSeconds);
  const endProgress = last.totalPages > 0 ? clamp(round2((last.page / last.totalPages) * 100), 0, 100) : null;
  const progressDelta = last.totalPages > 0 ? clamp(round2(((last.page - first.page) / last.totalPages) * 100), -100, 100) : null;

  return {
    sessionId: buildSessionId(deviceId, bookFileId, first.startTime),
    startedAt: new Date(first.startTime * 1000),
    endedAt: new Date(endEpoch * 1000),
    durationSeconds,
    progressDelta,
    endProgress,
  };
}

/** A span of device-clock seconds, half-open: [startTime, endTime). */
export interface KoreaderEventSpan {
  startTime: number;
  endTime: number;
}

/**
 * Drops events that start inside a deleted session's span. Half-open because the page after a
 * session's last one typically starts on the very second that session ends, and that page belongs
 * to whatever the reader did next.
 */
export function excludeTombstonedEvents<T extends { startTime: number }>(events: T[], spans: KoreaderEventSpan[]): T[] {
  if (spans.length === 0) return events;
  return events.filter((event) => !spans.some((span) => event.startTime >= span.startTime && event.startTime < span.endTime));
}

export function deriveKoreaderSessions(
  events: KoreaderPageEvent[],
  deviceId: string,
  bookFileId: number,
  gapSeconds: number = KOREADER_SESSION_GAP_SECONDS,
): DerivedKoreaderSession[] {
  return clusterPageStats(events, gapSeconds)
    .map((cluster) => computeClusterMetrics(cluster, deviceId, bookFileId))
    .filter((session) => session.durationSeconds >= KOREADER_MIN_SESSION_SECONDS);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
