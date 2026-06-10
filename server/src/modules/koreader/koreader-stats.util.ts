export const KOREADER_SESSION_GAP_SECONDS = 1800;
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

export function buildSessionIdPrefix(deviceId: string, bookFileId: number): string {
  return `kor:${deviceId.slice(0, 8)}:${bookFileId}:`;
}

export function buildSessionId(deviceId: string, bookFileId: number, clusterStartEpoch: number): string {
  return `${buildSessionIdPrefix(deviceId, bookFileId)}${clusterStartEpoch}`;
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
