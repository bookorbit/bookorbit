import type { ReadingAttemptOutcome } from '@bookorbit/types';

export const HARDCOVER_EXTERNAL_PROVIDER = 'hardcover';

export interface HardcoverReadCandidate {
  id: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface ReadingAttemptForSync {
  id: number;
  startedOn: string | null;
  endedOn: string | null;
  outcome: ReadingAttemptOutcome | null;
  externalProvider: string | null;
  externalId: string | null;
}

/**
 * The shape a Hardcover read must have to represent a given local attempt. `finished` mirrors what
 * the sync sends as `finished_at`, which is only ever populated for a completed attempt.
 */
export interface HardcoverReadTarget {
  startedOn: string | null;
  endedOn: string | null;
  finished: boolean;
}

/**
 * Mirrors the `active ?? latest` rule that rebuildProjection uses to decide which attempt drives
 * user_book_status. The book-level dates the sync pushes to Hardcover are that attempt's dates, so
 * both sides must agree on the choice or the sync links a read to the wrong attempt.
 */
export function selectPrimaryAttempt<T extends { id: number; outcome: ReadingAttemptOutcome | null }>(attempts: readonly T[]): T | null {
  let active: T | null = null;
  let latest: T | null = null;
  for (const attempt of attempts) {
    if (attempt.outcome === null && (active === null || attempt.id > active.id)) active = attempt;
    if (latest === null || attempt.id > latest.id) latest = attempt;
  }
  return active ?? latest;
}

export function attemptOwnedReadId(attempt: Pick<ReadingAttemptForSync, 'externalProvider' | 'externalId'>): number | null {
  if (attempt.externalProvider !== HARDCOVER_EXTERNAL_PROVIDER || !attempt.externalId) return null;
  const parsed = Number(attempt.externalId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readTargetForAttempt(attempt: Pick<ReadingAttemptForSync, 'startedOn' | 'endedOn' | 'outcome'>): HardcoverReadTarget {
  const finished = attempt.outcome === 'completed' && attempt.endedOn !== null;
  return { startedOn: attempt.startedOn, endedOn: finished ? attempt.endedOn : null, finished };
}

export function readTargetForBook(startedOn: string | null, endedOn: string | null): HardcoverReadTarget {
  return { startedOn, endedOn, finished: endedOn !== null };
}

/**
 * Adoption is only safe when the remote read plausibly *is* this target: open/finished state must
 * agree, and any date both sides state must be equal. Dates absent on either side are not evidence
 * against a match, since Hardcover reads routinely omit them.
 */
export function isReadCompatible(read: HardcoverReadCandidate, target: HardcoverReadTarget): boolean {
  if (Boolean(read.finished_at) !== target.finished) return false;
  if (read.started_at && target.startedOn && read.started_at !== target.startedOn) return false;
  if (read.finished_at && target.endedOn && read.finished_at !== target.endedOn) return false;
  return true;
}

function explicitMatchScore(read: HardcoverReadCandidate, target: HardcoverReadTarget): number {
  let score = 0;
  if (read.started_at && target.startedOn && read.started_at === target.startedOn) score++;
  if (read.finished_at && target.endedOn && read.finished_at === target.endedOn) score++;
  return score;
}

/**
 * Picks a remote read this target may take ownership of. `unavailable` carries every read id already
 * owned by another attempt - including soft-deleted ones, whose external ids stay reserved as
 * tombstones - plus everything claimed earlier in the same sync run.
 */
export function selectAdoptableReadId(
  reads: readonly HardcoverReadCandidate[],
  target: HardcoverReadTarget,
  unavailable: ReadonlySet<number>,
): number | null {
  let best: HardcoverReadCandidate | null = null;
  let bestScore = -1;
  for (const read of reads) {
    if (unavailable.has(read.id)) continue;
    if (!isReadCompatible(read, target)) continue;
    const score = explicitMatchScore(read, target);
    if (score > bestScore) {
      best = read;
      bestScore = score;
      continue;
    }
    if (score < bestScore || best === null) continue;
    // Equal evidence: keep the highest id, matching the descending order Hardcover returns. The
    // book-level cached id is deliberately not consulted because it is not attempt identity.
    if (read.id > best.id) best = read;
  }
  return best?.id ?? null;
}
