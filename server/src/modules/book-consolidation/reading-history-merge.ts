import type { ReadStatus, ReadStatusSource } from '@bookorbit/types';

export type MergeSide = 'target' | 'source';

export interface MergeAttempt {
  id: number;
  side: MergeSide;
  startedOn: string | null;
  endedOn: string | null;
  outcome: string | null;
  externalProvider: string | null;
  externalId: string | null;
  rating: number | null;
  deleted: boolean;
}

export interface MergeStatusRow {
  status: ReadStatus;
  source: ReadStatusSource;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AttemptUpdate {
  id: number;
  startedOn?: string | null;
  endedOn?: string | null;
  rating?: number | null;
  externalProvider?: string | null;
  externalId?: string | null;
}

export interface ReadingHistoryMergePlan {
  /** Losers whose external id moves to the survivor. Nulled first, or the unique index rejects the copy. */
  clearExternalIds: number[];
  /** Survivor changes, applied after `clearExternalIds`. */
  updates: AttemptUpdate[];
  /** Losers, soft-deleted. They keep any external id they were not asked to give up. */
  softDelete: number[];
  /** Sessions of a loser attempt move to its survivor. */
  sessionMoves: Array<{ from: number; to: number }>;
  status: MergeStatusRow | null;
}

/** Highest first. "Most advanced wins" picks the lower index. */
export const READ_STATUS_RANK: readonly ReadStatus[] = ['rereading', 'read', 'skimmed', 'reading', 'on_hold', 'abandoned', 'want_to_read', 'unread'];

function rankOf(status: ReadStatus): number {
  const index = READ_STATUS_RANK.indexOf(status);
  return index === -1 ? READ_STATUS_RANK.length : index;
}

function mostAdvanced(statuses: ReadStatus[]): ReadStatus {
  return statuses.reduce((best, status) => (rankOf(status) < rankOf(best) ? status : best), 'unread' as ReadStatus);
}

/** The projection's own ordering: `coalesce(ended_on, started_on) desc nulls last, id desc`. */
function compareLatestFirst(a: MergeAttempt, b: MergeAttempt): number {
  const aKey = a.endedOn ?? a.startedOn;
  const bKey = b.endedOn ?? b.startedOn;
  if (aKey !== bKey) {
    if (aKey === null) return 1;
    if (bKey === null) return -1;
    return aKey < bKey ? 1 : -1;
  }
  return b.id - a.id;
}

/** An undated start counts as later, so a dated attempt is the earlier one. */
function startsEarlier(a: MergeAttempt, b: MergeAttempt): boolean {
  if (a.startedOn === b.startedOn) return false;
  if (a.startedOn === null) return false;
  if (b.startedOn === null) return true;
  return a.startedOn < b.startedOn;
}

function minDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

const isLive = (attempt: MergeAttempt) => !attempt.deleted;
const isActive = (attempt: MergeAttempt) => isLive(attempt) && attempt.outcome === null;
const isCompleted = (attempt: MergeAttempt) => isLive(attempt) && attempt.outcome === 'completed';

class PlanBuilder {
  readonly clearExternalIds = new Set<number>();
  readonly updates = new Map<number, AttemptUpdate>();
  readonly softDelete = new Set<number>();
  readonly sessionMoves: Array<{ from: number; to: number }> = [];
  /** Both sides of every fold so far. */
  readonly folded = new Set<number>();

  constructor(private readonly attempts: Map<number, MergeAttempt>) {}

  update(id: number, change: Omit<AttemptUpdate, 'id'>): void {
    const attempt = this.attempts.get(id)!;
    Object.assign(attempt, change);
    this.updates.set(id, { ...(this.updates.get(id) ?? { id }), ...change });
  }

  /** Folds `loser` into `survivor`: sessions follow, and the survivor inherits a missing external id. */
  fold(loser: MergeAttempt, survivor: MergeAttempt): void {
    if (survivor.externalId === null && loser.externalId !== null) {
      const provider = loser.externalProvider;
      const externalId = loser.externalId;
      this.clearExternalIds.add(loser.id);
      loser.externalProvider = null;
      loser.externalId = null;
      this.update(survivor.id, { externalProvider: provider, externalId });
    }
    this.softDelete.add(loser.id);
    loser.deleted = true;
    this.sessionMoves.push({ from: loser.id, to: survivor.id });
    this.folded.add(loser.id);
    this.folded.add(survivor.id);
  }
}

function overlaps(a: MergeAttempt, b: MergeAttempt): boolean {
  if (a.endedOn === null || b.endedOn === null) return false;
  if (a.endedOn === b.endedOn) return true;
  const aStart = a.startedOn ?? a.endedOn;
  const bStart = b.startedOn ?? b.endedOn;
  return aStart <= b.endedOn && bStart <= a.endedOn;
}

/**
 * How one user's reading history on the kept book (target) and a merged-away book (source) becomes
 * one history. Pure: the caller applies the plan in order (clear external ids, updates, soft
 * deletes, session moves), then moves every source attempt to the target, then writes the status.
 */
export function planReadingHistoryMerge(input: {
  target: MergeAttempt[];
  source: MergeAttempt[];
  targetStatus: MergeStatusRow | null;
  sourceStatus: MergeStatusRow | null;
}): ReadingHistoryMergePlan {
  const all = [...input.target, ...input.source].map((attempt) => ({ ...attempt }));
  const byId = new Map(all.map((attempt) => [attempt.id, attempt]));
  const plan = new PlanBuilder(byId);
  const side = (which: MergeSide) => all.filter((attempt) => attempt.side === which);

  // 1. Two live active attempts: the earlier start survives and takes the earlier date.
  const targetActive = side('target').find(isActive);
  const sourceActive = side('source').find(isActive);
  if (targetActive && sourceActive) {
    const survivor = startsEarlier(sourceActive, targetActive) ? sourceActive : targetActive;
    const loser = survivor === targetActive ? sourceActive : targetActive;
    const startedOn = minDate(survivor.startedOn, loser.startedOn);
    if (startedOn !== survivor.startedOn) plan.update(survivor.id, { startedOn });
    plan.fold(loser, survivor);
  }

  // 3. An active attempt that began before the other side's latest completed read ended was the
  //    same read in another format, and that read finished. The survivor of step 1 already stands
  //    for both sides' open reads and may hold the loser's external id: folding it again would hand
  //    that id on a second time.
  const active = all.find(isActive);
  if (active && active.startedOn !== null && !plan.folded.has(active.id)) {
    const otherCompleted = all
      .filter((attempt) => attempt.side !== active.side && isCompleted(attempt) && attempt.endedOn !== null)
      .sort(compareLatestFirst)[0];
    if (otherCompleted && active.startedOn <= otherCompleted.endedOn!) {
      plan.fold(active, otherCompleted);
    }
  }

  // 4. Completed reads, one from each side, covering the same dates are one read.
  const targetCompleted = side('target').filter((attempt) => isCompleted(attempt) && attempt.endedOn !== null);
  const sourceCompleted = side('source').filter((attempt) => isCompleted(attempt) && attempt.endedOn !== null);
  for (const fromTarget of targetCompleted) {
    if (fromTarget.deleted) continue;
    const match = sourceCompleted.find((fromSource) => !fromSource.deleted && overlaps(fromTarget, fromSource));
    if (!match) continue;
    collapseCompleted(plan, fromTarget, match);
  }

  // 5. Completed reads with no end date.
  const undated = (which: MergeSide) => side(which).filter((attempt) => isCompleted(attempt) && attempt.endedOn === null);
  const targetUndated = undated('target');
  const sourceUndated = undated('source');
  if (targetUndated.length === 1 && sourceUndated.length === 1) {
    collapseCompleted(plan, targetUndated[0], sourceUndated[0]);
  } else {
    for (const [lone, otherSide] of [
      [targetUndated, 'source'],
      [sourceUndated, 'target'],
    ] as const) {
      if (lone.length !== 1 || lone[0].deleted) continue;
      const latestOther = side(otherSide).filter(isCompleted).sort(compareLatestFirst)[0];
      if (!latestOther) continue;
      inheritRating(plan, latestOther, lone[0]);
      plan.fold(lone[0], latestOther);
    }
  }

  return {
    clearExternalIds: [...plan.clearExternalIds],
    updates: [...plan.updates.values()],
    softDelete: [...plan.softDelete],
    sessionMoves: plan.sessionMoves,
    status: projectMergedStatus(all, input.targetStatus, input.sourceStatus),
  };
}

function inheritRating(plan: PlanBuilder, survivor: MergeAttempt, loser: MergeAttempt): void {
  if (survivor.rating === null && loser.rating !== null) plan.update(survivor.id, { rating: loser.rating });
}

function collapseCompleted(plan: PlanBuilder, a: MergeAttempt, b: MergeAttempt): void {
  const survivor = a.externalId !== null && b.externalId === null ? a : b.externalId !== null && a.externalId === null ? b : a.id > b.id ? a : b;
  const loser = survivor === a ? b : a;
  const startedOn = minDate(survivor.startedOn, loser.startedOn);
  const endedOn = maxDate(survivor.endedOn, loser.endedOn);
  const change: Omit<AttemptUpdate, 'id'> = {};
  if (startedOn !== survivor.startedOn) change.startedOn = startedOn;
  if (endedOn !== survivor.endedOn) change.endedOn = endedOn;
  if (Object.keys(change).length > 0) plan.update(survivor.id, change);
  inheritRating(plan, survivor, loser);
  plan.fold(loser, survivor);
}

function toUtcDate(day: string | null): Date | null {
  return day === null ? null : new Date(`${day}T00:00:00.000Z`);
}

/**
 * The status the merged history projects to, with "most advanced wins" over the two status rows
 * where the history alone would keep a manual `unread` or `want_to_read`.
 */
function projectMergedStatus(attempts: MergeAttempt[], target: MergeStatusRow | null, source: MergeStatusRow | null): MergeStatusRow | null {
  const live = attempts.filter(isLive);
  if (live.length === 0 && !target && !source) return null;

  const sourceOf: ReadStatusSource =
    target?.source === 'manual' || source?.source === 'manual' ? 'manual' : (target?.source ?? source?.source ?? 'manual');
  const active = live.find((attempt) => attempt.outcome === null);
  const hasCompleted = live.some((attempt) => attempt.outcome === 'completed');

  if (active) {
    const activeSideStatus = active.side === 'target' ? target?.status : source?.status;
    const finishedBefore = hasCompleted || [target?.status, source?.status].some((status) => status === 'read' || status === 'rereading');
    const status: ReadStatus = activeSideStatus === 'on_hold' ? 'on_hold' : finishedBefore ? 'rereading' : 'reading';
    return { status, source: sourceOf, startedAt: toUtcDate(active.startedOn), finishedAt: null };
  }

  const latest = [...live].sort(compareLatestFirst)[0];
  const derived: ReadStatus =
    latest?.outcome === 'completed' ? 'read' : latest?.outcome === 'skimmed' ? 'skimmed' : latest?.outcome === 'abandoned' ? 'abandoned' : 'unread';
  const candidates: Array<{ status: ReadStatus; row: MergeStatusRow | null }> = [
    { status: derived, row: null },
    ...(target ? [{ status: target.status, row: target }] : []),
    ...(source ? [{ status: source.status, row: source }] : []),
  ];
  const status = mostAdvanced(candidates.map((candidate) => candidate.status));
  if (status === 'unread' || status === 'want_to_read') return { status, source: sourceOf, startedAt: null, finishedAt: null };
  if (status === derived && latest) {
    return {
      status,
      source: sourceOf,
      startedAt: toUtcDate(latest.startedOn),
      finishedAt: latest.outcome === 'completed' ? toUtcDate(latest.endedOn) : null,
    };
  }
  const row = candidates.find((candidate) => candidate.status === status)?.row ?? null;
  return { status, source: sourceOf, startedAt: row?.startedAt ?? null, finishedAt: row?.finishedAt ?? null };
}
