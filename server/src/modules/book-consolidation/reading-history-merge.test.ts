import { READ_STATUSES, type ReadStatus } from '@bookorbit/types';

import { planReadingHistoryMerge, READ_STATUS_RANK, type MergeAttempt, type MergeSide, type MergeStatusRow } from './reading-history-merge';

let nextId = 1;

function attempt(side: MergeSide, overrides: Partial<MergeAttempt> = {}): MergeAttempt {
  return {
    id: nextId++,
    side,
    startedOn: null,
    endedOn: null,
    outcome: null,
    externalProvider: null,
    externalId: null,
    rating: null,
    deleted: false,
    ...overrides,
  };
}

function status(value: ReadStatus, source: 'manual' | 'auto' = 'auto'): MergeStatusRow {
  return { status: value, source, startedAt: null, finishedAt: null };
}

beforeEach(() => {
  nextId = 1;
});

describe('planReadingHistoryMerge', () => {
  it('keeps the earlier of two active reads, takes its start date, and moves the loser’s external id first', () => {
    const k = attempt('target', { startedOn: '2024-03-01' });
    const s = attempt('source', { startedOn: '2024-01-15', externalProvider: 'hardcover', externalId: '77' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('reading'), sourceStatus: status('reading') });

    expect(plan.softDelete).toEqual([k.id]);
    expect(plan.sessionMoves).toEqual([{ from: k.id, to: s.id }]);
    expect(plan.clearExternalIds).toEqual([]);
    expect(plan.status?.status).toBe('reading');
    expect(plan.status?.startedAt?.toISOString().slice(0, 10)).toBe('2024-01-15');
  });

  it('moves the external id onto a surviving active read that has none, clearing the loser first', () => {
    const k = attempt('target', { startedOn: '2024-01-01' });
    const s = attempt('source', { startedOn: '2024-02-01', externalProvider: 'hardcover', externalId: 'h-1' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null });

    expect(plan.clearExternalIds).toEqual([s.id]);
    expect(plan.updates).toContainEqual({ id: k.id, externalProvider: 'hardcover', externalId: 'h-1' });
    expect(plan.softDelete).toEqual([s.id]);
  });

  it('keeps both external ids where they are when both active reads have one', () => {
    const k = attempt('target', { startedOn: '2024-01-01', externalProvider: 'hardcover', externalId: 'a' });
    const s = attempt('source', { startedOn: '2024-02-01', externalProvider: 'hardcover', externalId: 'b' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null });

    expect(plan.clearExternalIds).toEqual([]);
    expect(plan.updates.find((update) => update.externalId !== undefined)).toBeUndefined();
    expect(plan.softDelete).toEqual([s.id]);
  });

  it('treats an undated start as the later one', () => {
    const k = attempt('target', { startedOn: null });
    const s = attempt('source', { startedOn: '2024-02-01' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null });

    expect(plan.softDelete).toEqual([k.id]);
  });

  it('folds an active read into the other side’s completed read that ended after it began', () => {
    const k = attempt('target', { startedOn: '2023-01-01', endedOn: '2023-03-01', outcome: 'completed' });
    const s = attempt('source', { startedOn: '2023-02-01' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('read'), sourceStatus: status('reading') });

    expect(plan.softDelete).toEqual([s.id]);
    expect(plan.sessionMoves).toEqual([{ from: s.id, to: k.id }]);
    expect(plan.status?.status).toBe('read');
  });

  it('keeps an active read that began after the other side’s read finished, as a reread', () => {
    const k = attempt('target', { startedOn: '2023-01-01', endedOn: '2023-03-01', outcome: 'completed' });
    const s = attempt('source', { startedOn: '2024-02-01' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('read'), sourceStatus: status('reading') });

    expect(plan.softDelete).toEqual([]);
    expect(plan.status?.status).toBe('rereading');
  });

  it('never folds an active read with no start date', () => {
    const k = attempt('target', { startedOn: '2023-01-01', endedOn: '2023-03-01', outcome: 'completed' });
    const s = attempt('source', { startedOn: null });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null });

    expect(plan.softDelete).toEqual([]);
  });

  it('collapses overlapping completed reads into the one with an external id, widening the dates and keeping a rating', () => {
    const k = attempt('target', { startedOn: '2023-01-05', endedOn: '2023-02-01', outcome: 'completed', rating: 4 });
    const s = attempt('source', {
      startedOn: '2023-01-01',
      endedOn: '2023-01-20',
      outcome: 'completed',
      externalProvider: 'hardcover',
      externalId: 'r1',
    });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('read'), sourceStatus: status('read') });

    expect(plan.softDelete).toEqual([k.id]);
    expect(plan.updates).toContainEqual({ id: s.id, endedOn: '2023-02-01', rating: 4 });
    expect(plan.status).toMatchObject({ status: 'read' });
    expect(plan.status?.finishedAt?.toISOString().slice(0, 10)).toBe('2023-02-01');
  });

  it('keeps genuine rereads apart', () => {
    const k = attempt('target', { startedOn: '2020-01-01', endedOn: '2020-02-01', outcome: 'completed' });
    const s = attempt('source', { startedOn: '2023-01-01', endedOn: '2023-02-01', outcome: 'completed' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('read'), sourceStatus: status('read') });

    expect(plan.softDelete).toEqual([]);
  });

  it('folds one undated completed read into the other side’s latest completed read', () => {
    const k = attempt('target', { outcome: 'completed' });
    const s1 = attempt('source', { startedOn: '2020-01-01', endedOn: '2020-02-01', outcome: 'completed' });
    const s2 = attempt('source', { startedOn: '2022-01-01', endedOn: '2022-02-01', outcome: 'completed' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s1, s2], targetStatus: status('read'), sourceStatus: status('read') });

    expect(plan.softDelete).toEqual([k.id]);
    expect(plan.sessionMoves).toEqual([{ from: k.id, to: s2.id }]);
  });

  it('collapses undated completed reads on both sides into one, and leaves several undated on one side alone', () => {
    const k = attempt('target', { outcome: 'completed' });
    const s = attempt('source', { outcome: 'completed' });
    expect(planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null }).softDelete).toHaveLength(1);

    const k1 = attempt('target', { outcome: 'completed' });
    const k2 = attempt('target', { outcome: 'completed' });
    const plan = planReadingHistoryMerge({ target: [k1, k2], source: [], targetStatus: null, sourceStatus: null });
    expect(plan.softDelete).toEqual([]);
  });

  it('never folds skimmed or abandoned reads into a completed one', () => {
    const k = attempt('target', { startedOn: '2023-01-01', endedOn: '2023-02-01', outcome: 'completed' });
    const s = attempt('source', { outcome: 'abandoned' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: status('read'), sourceStatus: status('abandoned') });

    expect(plan.softDelete).toEqual([]);
    expect(plan.status?.status).toBe('read');
  });

  it('keeps on hold when the surviving active read came from the on-hold side', () => {
    const k = attempt('target', { startedOn: '2024-01-01' });

    const plan = planReadingHistoryMerge({ target: [k], source: [], targetStatus: status('on_hold'), sourceStatus: status('unread') });

    expect(plan.status?.status).toBe('on_hold');
  });

  it('lifts a manual want-to-read to the other side’s finished read', () => {
    const s = attempt('source', { startedOn: '2023-01-01', endedOn: '2023-02-01', outcome: 'completed' });

    const plan = planReadingHistoryMerge({
      target: [],
      source: [s],
      targetStatus: status('want_to_read', 'manual'),
      sourceStatus: status('read'),
    });

    expect(plan.status).toMatchObject({ status: 'read', source: 'manual' });
  });

  /** Applies a plan in the caller's order and returns every attempt's external id afterwards. */
  function externalIdsAfter(attempts: MergeAttempt[], plan: ReturnType<typeof planReadingHistoryMerge>): Map<number, string | null> {
    const ids = new Map(attempts.map((row) => [row.id, row.externalId]));
    for (const id of plan.clearExternalIds) ids.set(id, null);
    for (const update of plan.updates) {
      if (update.externalId === undefined) continue;
      // reading_attempts_external_uidx ignores deleted_at: every row counts, live or not.
      const holder = [...ids].find(([id, value]) => id !== update.id && value !== null && value === update.externalId);
      if (holder) throw new Error(`external id ${update.externalId} written to ${update.id} while ${holder[0]} still holds it`);
      ids.set(update.id, update.externalId);
    }
    return ids;
  }

  it('folds the survivor of two active reads at most once, so an inherited external id is never written twice', () => {
    const k = attempt('target', { startedOn: '2024-01-01' });
    const s = attempt('source', { startedOn: '2024-02-01', externalProvider: 'hardcover', externalId: 'h-1' });
    const finished = attempt('source', { startedOn: '2023-12-01', endedOn: '2024-03-01', outcome: 'completed' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s, finished], targetStatus: status('reading'), sourceStatus: status('reading') });

    const ids = externalIdsAfter([k, s, finished], plan);
    expect([...ids.values()].filter((value) => value === 'h-1')).toHaveLength(1);
    expect(plan.softDelete).toEqual([s.id]);
    expect(new Set(plan.sessionMoves.map((move) => move.from)).size).toBe(plan.sessionMoves.length);
  });

  it('ignores soft-deleted attempts for the status and folding', () => {
    const k = attempt('target', { startedOn: '2024-01-01', deleted: true });
    const s = attempt('source', { startedOn: '2024-02-01' });

    const plan = planReadingHistoryMerge({ target: [k], source: [s], targetStatus: null, sourceStatus: null });

    expect(plan.softDelete).toEqual([]);
    expect(plan.status?.status).toBe('reading');
  });

  describe('every pair of statuses', () => {
    function historyFor(value: ReadStatus, side: MergeSide): MergeAttempt[] {
      switch (value) {
        case 'reading':
        case 'on_hold':
          return [attempt(side, { startedOn: side === 'target' ? '2024-05-01' : '2024-06-01' })];
        case 'rereading':
          return [
            attempt(side, { startedOn: '2019-01-01', endedOn: '2019-02-01', outcome: 'completed' }),
            attempt(side, { startedOn: side === 'target' ? '2024-05-01' : '2024-06-01' }),
          ];
        case 'read':
          return [attempt(side, { startedOn: '2021-01-01', endedOn: side === 'target' ? '2021-02-01' : '2021-03-01', outcome: 'completed' })];
        case 'skimmed':
          return [attempt(side, { startedOn: '2022-01-01', endedOn: '2022-01-05', outcome: 'skimmed' })];
        case 'abandoned':
          return [attempt(side, { startedOn: '2022-03-01', endedOn: '2022-03-05', outcome: 'abandoned' })];
        default:
          return [];
      }
    }

    const pairs = READ_STATUSES.flatMap((targetValue) => READ_STATUSES.map((sourceValue) => [targetValue, sourceValue] as const));
    const rank = (value: ReadStatus) => READ_STATUS_RANK.indexOf(value);

    it.each(pairs)('target %s with source %s ends at least as advanced, with at most one active read', (targetValue, sourceValue) => {
      const target = historyFor(targetValue, 'target');
      const source = historyFor(sourceValue, 'source');
      const plan = planReadingHistoryMerge({ target, source, targetStatus: status(targetValue), sourceStatus: status(sourceValue) });

      const softDeleted = new Set(plan.softDelete);
      const liveActive = [...target, ...source].filter((row) => row.outcome === null && !softDeleted.has(row.id));
      expect(liveActive.length).toBeLessThanOrEqual(1);

      const result = plan.status!.status;
      const onHoldSurvived = liveActive.length === 1 && (liveActive[0].side === 'target' ? targetValue : sourceValue) === 'on_hold';
      if (onHoldSurvived) {
        expect(result).toBe('on_hold');
      } else if (liveActive.length === 1) {
        // An open read projects as reading; "most advanced wins" only lifts a manual unread or want-to-read.
        expect(['reading', 'rereading']).toContain(result);
      } else {
        expect(rank(result)).toBeLessThanOrEqual(Math.min(rank(targetValue), rank(sourceValue)));
      }

      const live = target.length + source.length - plan.softDelete.length;
      expect(live).toBeGreaterThanOrEqual(target.length > 0 || source.length > 0 ? 1 : 0);
      for (const move of plan.sessionMoves) expect(softDeleted.has(move.from)).toBe(true);
    });
  });
});
