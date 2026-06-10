import { describe, expect, it } from 'vitest';

import {
  buildSessionId,
  buildSessionIdPrefix,
  clusterPageStats,
  computeClusterMetrics,
  deriveKoreaderSessions,
  type KoreaderPageEvent,
} from './koreader-stats.util';

const DEVICE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
const FILE_ID = 42;

function event(startTime: number, durationSeconds = 60, page = 1, totalPages = 100): KoreaderPageEvent {
  return { page, startTime, durationSeconds, totalPages };
}

describe('clusterPageStats', () => {
  it('returns a single cluster for one event', () => {
    expect(clusterPageStats([event(1000)])).toHaveLength(1);
  });

  it('returns no clusters for no events', () => {
    expect(clusterPageStats([])).toHaveLength(0);
  });

  it('keeps a gap of exactly the threshold in the same cluster', () => {
    const clusters = clusterPageStats([event(1000, 60), event(1000 + 60 + 1800, 60)]);
    expect(clusters).toHaveLength(1);
  });

  it('splits when the gap exceeds the threshold by one second', () => {
    const clusters = clusterPageStats([event(1000, 60), event(1000 + 60 + 1801, 60)]);
    expect(clusters).toHaveLength(2);
  });

  it('sorts unordered input before clustering', () => {
    const clusters = clusterPageStats([event(5000), event(1000), event(5100)]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]![0]!.startTime).toBe(1000);
  });

  it('measures gaps from the furthest cluster end with overlapping events', () => {
    // First event spans 1000-2000; the short second event does not shrink the cluster end,
    // so an event at 3700 (gap 1700 from 2000) still joins the cluster.
    const clusters = clusterPageStats([event(1000, 1000), event(1500, 100), event(3700, 60)]);
    expect(clusters).toHaveLength(1);
  });
});

describe('computeClusterMetrics', () => {
  it('uses the event duration for a single-event cluster', () => {
    const session = computeClusterMetrics([event(1000, 45, 10, 200)], DEVICE_ID, FILE_ID);
    expect(session.durationSeconds).toBe(45);
    expect(session.startedAt).toEqual(new Date(1000 * 1000));
    expect(session.endedAt).toEqual(new Date(1045 * 1000));
  });

  it('caps duration at the wall clock span for overlapping events', () => {
    const session = computeClusterMetrics([event(1000, 600), event(1000, 600)], DEVICE_ID, FILE_ID);
    expect(session.durationSeconds).toBe(600);
  });

  it('sums durations and excludes idle time inside the cluster', () => {
    const session = computeClusterMetrics([event(1000, 60), event(2000, 60)], DEVICE_ID, FILE_ID);
    expect(session.durationSeconds).toBe(120);
    expect(session.endedAt).toEqual(new Date(2060 * 1000));
  });

  it('computes endProgress from the last event and progressDelta from first to last', () => {
    const session = computeClusterMetrics([event(1000, 60, 10, 200), event(1100, 60, 30, 200)], DEVICE_ID, FILE_ID);
    expect(session.endProgress).toBe(15);
    expect(session.progressDelta).toBe(10);
  });

  it('allows negative progressDelta when reading backwards', () => {
    const session = computeClusterMetrics([event(1000, 60, 50, 100), event(1100, 60, 20, 100)], DEVICE_ID, FILE_ID);
    expect(session.progressDelta).toBe(-30);
    expect(session.endProgress).toBe(20);
  });

  it('builds deterministic session ids that fit varchar(64)', () => {
    const session = computeClusterMetrics([event(1000)], DEVICE_ID, FILE_ID);
    expect(session.sessionId).toBe('kor:abcdef12:42:1000');

    const longest = buildSessionId(DEVICE_ID, 2147483647, 2147483647);
    expect(longest).toBe('kor:abcdef12:2147483647:2147483647');
    expect(longest.length).toBeLessThanOrEqual(64);
  });
});

describe('deriveKoreaderSessions', () => {
  it('drops sessions shorter than the minimum duration', () => {
    const sessions = deriveKoreaderSessions([event(1000, 5)], DEVICE_ID, FILE_ID);
    expect(sessions).toHaveLength(0);
  });

  it('merges two sessions when a late gap-filling event arrives, keeping the earlier session id', () => {
    const early = [event(1000, 60, 10), event(2000, 60, 12)];
    const late = [event(5000, 60, 20)];

    const before = deriveKoreaderSessions([...early, ...late], DEVICE_ID, FILE_ID);
    expect(before).toHaveLength(2);
    expect(before.map((s) => s.sessionId)).toEqual([buildSessionId(DEVICE_ID, FILE_ID, 1000), buildSessionId(DEVICE_ID, FILE_ID, 5000)]);

    const filler = event(3500, 60, 15);
    const after = deriveKoreaderSessions([...early, ...late, filler], DEVICE_ID, FILE_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.sessionId).toBe(buildSessionId(DEVICE_ID, FILE_ID, 1000));
    expect(after[0]!.durationSeconds).toBe(240);
  });

  it('builds a prefix that scopes ids per device and file', () => {
    expect(buildSessionIdPrefix(DEVICE_ID, FILE_ID)).toBe('kor:abcdef12:42:');
  });
});
