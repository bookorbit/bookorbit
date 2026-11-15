import type { JobAccess, JobSource, SourceRow } from '../job-source';
import { compareJobPositions, jobViewDirection, type JobKey, type JobPosition } from '../job-keyset';
import type { JobType, JobView } from '@bookorbit/types';

export interface FakeJob {
  id: string;
  view: JobView;
  ownerId: number | null;
  prefix: number[];
  suffix: number[];
}

function lexCompare(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!;
    const right = b[index]!;
    if (left === right) continue;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left) < String(right) ? -1 : 1;
  }
  return 0;
}

/**
 * The cursor rule written out the way the SQL helper builds it, independent of
 * `compareJobPositions`, so the property tests catch any disagreement between the two.
 */
export function ruleSaysAfter(view: JobView, key: JobKey, typeIndex: number, cursor: JobPosition): boolean {
  const sign = jobViewDirection(view) === 'asc' ? 1 : -1;
  const prefix = sign * lexCompare(key.prefix, cursor.prefix);
  if (typeIndex < cursor.typeIndex) return prefix > 0;
  if (typeIndex > cursor.typeIndex) return prefix >= 0;
  return sign * lexCompare([...key.prefix, ...key.suffix, key.id], [...cursor.prefix, ...cursor.suffix, cursor.id]) > 0;
}

/** An adapter over an in-memory list that answers `list` the way a real one answers with SQL. */
export function createFakeJobSource(type: JobType, jobs: FakeJob[], access: JobAccess = { own: true, all: true }): JobSource & { jobs: FakeJob[] } {
  return {
    type,
    failedWindowMs: 30_000,
    jobs,
    access: () => access,
    list: (query) => {
      const rows: SourceRow[] = jobs
        .filter((job) => job.view === query.view)
        .filter((job) => query.owner === null || job.ownerId === query.owner.id || (query.owner.ownerless && job.ownerId === null))
        .map((job) => ({
          nativeId: job.id,
          key: { prefix: job.prefix, suffix: job.suffix, id: job.id },
          item: {
            kind: null,
            shape: 'job',
            status: query.view === 'queue' ? 'queued' : 'completed',
            reason: null,
            phase: null,
            done: null,
            total: null,
            percent: null,
            position: null,
            requester: null,
            cost: null,
            createdAt: '2026-11-15T00:00:00.000Z',
            startedAt: null,
            pausedAt: null,
            finishedAt: null,
            extra: null,
          },
        }));
      const after = query.after;
      const own = (key: JobKey): JobPosition => ({ ...key, typeIndex: query.typeIndex });
      return Promise.resolve(
        rows
          .filter((row) => after === null || ruleSaysAfter(query.view, row.key, query.typeIndex, after))
          .sort((a, b) => compareJobPositions(query.view, own(a.key), own(b.key)))
          .slice(0, query.limit),
      );
    },
    counts: () => Promise.resolve({ queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 }),
    describe: () => Promise.resolve(new Map()),
    actions: () => ({ actions: [], note: 'owner-only' }),
    act: (action, ids) => Promise.resolve(ids.map((id) => ({ id, outcome: 'done' as const, status: 'cancelled' as const }))),
  };
}
