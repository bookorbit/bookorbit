import { toDateKeyInTimeZone, toTimeZoneStartOfDay } from './timezone.utils';

export interface ReadingSessionDailyStatsInput {
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
}

export interface ReadingDailyStatsSegment {
  day: string;
  readingSeconds: number;
  progressDelta: number;
  sessionsCount: number;
}

export interface ReadingDailyStatsDayRange {
  start: Date;
  end: Date;
}

export function addDateKeyDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

export function getReadingSessionDayKeys(session: ReadingSessionDailyStatsInput, timeZone: string): string[] {
  return splitReadingSessionByDay(session, timeZone).map((segment) => segment.day);
}

export function getDayRangeForDateKeys(days: string[], timeZone: string): ReadingDailyStatsDayRange | null {
  if (days.length === 0) return null;
  const sorted = [...new Set(days)].sort();
  const firstDay = sorted[0]!;
  const lastExclusive = addDateKeyDays(sorted[sorted.length - 1]!, 1);
  return {
    start: toTimeZoneStartOfDay(firstDay, timeZone),
    end: toTimeZoneStartOfDay(lastExclusive, timeZone),
  };
}

export function splitReadingSessionByDay(session: ReadingSessionDailyStatsInput, timeZone: string): ReadingDailyStatsSegment[] {
  if (session.durationSeconds <= 0) return [];

  const startMs = session.startedAt.getTime();
  const endMs = session.endedAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const wallClockMs = endMs - startMs;
  if (wallClockMs <= 0) {
    return [
      {
        day: toDateKeyInTimeZone(session.startedAt, timeZone),
        readingSeconds: session.durationSeconds,
        progressDelta: session.progressDelta ?? 0,
        sessionsCount: 1,
      },
    ];
  }

  const pieces: Array<{ day: string; rawSeconds: number; fractional: number }> = [];
  let cursor = new Date(startMs);

  while (cursor.getTime() < endMs) {
    const day = toDateKeyInTimeZone(cursor, timeZone);
    const nextDayStart = toTimeZoneStartOfDay(addDateKeyDays(day, 1), timeZone);
    const nextBoundaryMs = nextDayStart.getTime() > cursor.getTime() ? nextDayStart.getTime() : endMs;
    const segmentEndMs = Math.min(endMs, nextBoundaryMs);
    const overlapMs = Math.max(0, segmentEndMs - cursor.getTime());
    const rawSeconds = (session.durationSeconds * overlapMs) / wallClockMs;
    pieces.push({ day, rawSeconds, fractional: rawSeconds - Math.floor(rawSeconds) });
    cursor = new Date(segmentEndMs);
  }

  if (pieces.length === 0) return [];

  const secondsByIndex = pieces.map((piece) => Math.floor(piece.rawSeconds));
  let remainder = session.durationSeconds - secondsByIndex.reduce((sum, seconds) => sum + seconds, 0);
  const remainderOrder = pieces.map((piece, index) => ({ index, fractional: piece.fractional })).sort((a, b) => b.fractional - a.fractional);

  for (const { index } of remainderOrder) {
    if (remainder <= 0) break;
    secondsByIndex[index] += 1;
    remainder -= 1;
  }

  return pieces
    .map((piece, index) => {
      const readingSeconds = secondsByIndex[index] ?? 0;
      return {
        day: piece.day,
        readingSeconds,
        progressDelta: session.progressDelta == null ? 0 : session.progressDelta * (readingSeconds / session.durationSeconds),
        sessionsCount: 1,
      };
    })
    .filter((segment) => segment.readingSeconds > 0);
}

export function aggregateReadingSessionDailyStats(
  sessions: ReadingSessionDailyStatsInput[],
  timeZone: string,
  days?: Set<string>,
): ReadingDailyStatsSegment[] {
  const byDay = new Map<string, ReadingDailyStatsSegment>();
  for (const session of sessions) {
    for (const segment of splitReadingSessionByDay(session, timeZone)) {
      if (days && !days.has(segment.day)) continue;
      const existing = byDay.get(segment.day);
      if (existing) {
        existing.readingSeconds += segment.readingSeconds;
        existing.progressDelta += segment.progressDelta;
        existing.sessionsCount += segment.sessionsCount;
      } else {
        byDay.set(segment.day, { ...segment });
      }
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
