import { Injectable, Logger } from '@nestjs/common';
import { stat, unlink } from 'fs/promises';
import { dirname } from 'path';

import type { BookMergeField, BookMergeSourceOutcome } from '@bookorbit/types';

import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { buildSuppressionPaths, isInsideRoot, moveFile, moveFileBack, pathExists, removeEmptyDirs } from '../../common/utils/file-move.utils';
import type { BookMergeJobMove } from '../../db/schema';
import { BookConsolidationService, type ConsolidateResult, type FileRowUpdate } from '../book-consolidation/book-consolidation.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import type { BookCoverSlotRow } from '../book-cover-store/book-cover-store.repository';
import { FileRenameService } from '../file-write/file-rename.service';
import type { MergeExecutionPlan, MergeStep } from './book-merge.planner';
import { BookMergeRepository, type MergeJobRow } from './book-merge.repository';

const MERGE_EVENT = 'book_merge';
/** Byte progress is sent at most this often while files copy between drives. */
const BYTE_PROGRESS_INTERVAL_MS = 1000;

/** A change to the job as it runs, with the bytes moved so far when files move. */
export type MergeProgress = Partial<MergeJobRow> & { bytesDone?: number; bytesTotal?: number };

/** A failure with a stable code for the job's outcome. */
export class BookMergeStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BookMergeStepError';
  }
}

export interface MergeRunResult {
  outcomes: BookMergeSourceOutcome[];
  merged: Array<{ sourceBookId: number; result: ConsolidateResult }>;
  movedFileCount: number;
  crossDevice: boolean;
  /** The step that failed rolled back cleanly. */
  rolledBack: boolean;
  /** A file could not be put back. Both paths are in the job's error and the log. */
  failed: boolean;
  errorCode: string | null;
}

/** Stored in the job's plan before each commit, so recovery can still hand the covers over. */
export type StoredCoverSlots = Record<
  string,
  Array<Omit<BookCoverSlotRow, 'updatedAt' | 'dormantSince'> & { updatedAt: string; dormantSince: string | null }>
>;

/** Stored in the job's plan with each commit, so recovery can still run the per-user effects. */
export type StoredReaders = Record<string, { affectedUserIds: number[]; ratingChangedUserIds: number[]; koboEntitlementMovedUserIds: number[] }>;

/** The readers of the given merged sources, or null when a source's were never stored. */
export function storedReadersOf(
  plan: unknown,
  sourceBookIds: number[],
): { affectedUserIds: number[]; ratingChangedUserIds: number[]; koboEntitlementMovedUserIds: number[] } | null {
  const stored = (plan as { readers?: StoredReaders } | null)?.readers ?? {};
  const entries = sourceBookIds.map((id) => stored[String(id)]);
  if (entries.some((entry) => entry === undefined)) return null;
  const union = (pick: (entry: StoredReaders[string]) => number[]) => [...new Set(entries.flatMap(pick))];
  return {
    affectedUserIds: union((entry) => entry.affectedUserIds),
    ratingChangedUserIds: union((entry) => entry.ratingChangedUserIds),
    koboEntitlementMovedUserIds: union((entry) => entry.koboEntitlementMovedUserIds),
  };
}

export function reviveCoverSlots(stored: StoredCoverSlots[string] | undefined): BookCoverSlotRow[] {
  return (stored ?? []).map((slot) => ({
    ...slot,
    updatedAt: new Date(slot.updatedAt),
    dormantSince: slot.dormantSince ? new Date(slot.dormantSince) : null,
  }));
}

/**
 * Runs a planned merge: locks every book, then for each source moves its files (each move journaled
 * before the disk is touched) and commits the database change in one transaction. A failed step is
 * moved back and stops the job; sources already committed stay merged.
 */
@Injectable()
export class BookMergeExecutor {
  private readonly logger = new Logger(BookMergeExecutor.name);

  constructor(
    private readonly repository: BookMergeRepository,
    private readonly consolidation: BookConsolidationService,
    private readonly fileLocks: FileLockService,
    private readonly selfWrites: SelfWriteRegistry,
    private readonly coverStore: BookCoverStore,
    private readonly fileRename: FileRenameService,
  ) {}

  async run(job: MergeJobRow, plan: MergeExecutionPlan, onProgress: (change: MergeProgress) => void): Promise<MergeRunResult> {
    const ids = [...new Set([plan.targetBookId, ...plan.steps.map((step) => step.sourceBookId)])].sort((a, b) => a - b);
    return this.withLocks(ids, async () => {
      for (const id of ids) this.fileRename.cancelPendingRename(id);
      const suppression = this.suppressionPaths(plan);
      this.selfWrites.begin(suppression);
      try {
        return await this.runSteps(job, plan, onProgress);
      } finally {
        this.selfWrites.end(suppression);
      }
    });
  }

  private async withLocks<T>(ids: number[], work: () => Promise<T>): Promise<T> {
    const [first, ...rest] = ids;
    if (first === undefined) return work();
    return this.fileLocks.withLock(bookOperationLockKey(first), () => this.withLocks(rest, work));
  }

  private suppressionPaths(plan: MergeExecutionPlan): string[] {
    const paths = new Set<string>();
    for (const step of plan.steps) {
      for (const path of buildSuppressionPaths({
        sourcePaths: step.moves.map((move) => move.from),
        targetPaths: step.moves.map((move) => move.to),
        sourceFolderPath: step.vacatedFolders[0] ?? plan.destination.folderPath,
        targetFolderPath: plan.destination.folderPath,
        roots: step.roots,
      })) {
        paths.add(path);
      }
      for (const folder of step.vacatedFolders) paths.add(folder);
    }
    return [...paths];
  }

  private async runSteps(job: MergeJobRow, plan: MergeExecutionPlan, onProgress: (change: MergeProgress) => void): Promise<MergeRunResult> {
    const outcomes: BookMergeSourceOutcome[] = plan.steps.map((step) => ({ sourceBookId: step.sourceBookId, status: 'pending', errorCode: null }));
    const merged: MergeRunResult['merged'] = [];
    const storedSlots: StoredCoverSlots = { ...((job.plan as { coverSlots?: StoredCoverSlots }).coverSlots ?? {}) };
    const storedReaders: StoredReaders = { ...((job.plan as { readers?: StoredReaders }).readers ?? {}) };
    let movedFileCount = 0;
    let crossDevice = false;
    let processed = 0;
    const bytesTotal = plan.steps.reduce(
      (total, step) => total + step.moves.filter((move) => move.kind === 'move').reduce((bytes, move) => bytes + (move.expectedSize ?? 0), 0),
      0,
    );
    let bytesDone = 0;
    let lastBytesAt = 0;

    for (const [index, step] of plan.steps.entries()) {
      const outcome = outcomes[index];
      const journal: BookMergeJobMove[] = [];
      await this.repository.updateJob(job.id, { status: 'moving', currentSourceBookId: step.sourceBookId, moves: [], outcomes });
      onProgress({ status: 'moving', currentSourceBookId: step.sourceBookId, processed, outcomes, bytesDone, bytesTotal });
      const onBytes = (copied: number): void => {
        const now = Date.now();
        if (now - lastBytesAt < BYTE_PROGRESS_INTERVAL_MS) return;
        lastBytesAt = now;
        onProgress({ status: 'moving', currentSourceBookId: step.sourceBookId, processed, outcomes, bytesDone: bytesDone + copied, bytesTotal });
      };

      try {
        const slots = await this.coverStore.slotsForAdoption(step.sourceBookId);
        storedSlots[String(step.sourceBookId)] = slots.map((slot) => ({
          ...slot,
          updatedAt: slot.updatedAt.toISOString(),
          dormantSince: slot.dormantSince ? slot.dormantSince.toISOString() : null,
        }));
        await this.repository.updateJob(job.id, { plan: { ...(job.plan as object), coverSlots: storedSlots } });

        const stats = await this.moveFiles(job.id, step, journal, onBytes, (bytes) => {
          bytesDone += bytes;
        });
        movedFileCount += step.moves.filter((move) => move.kind === 'move').length;
        crossDevice = crossDevice || step.moves.some((move) => move.crossDevice);

        const result = await this.repository.transaction(async (tx) => {
          await this.repository.updateJob(job.id, { status: 'committing' }, tx);
          const consolidated = await this.consolidation.consolidate(tx, {
            targetBookId: plan.targetBookId,
            sourceBookId: step.sourceBookId,
            destination: { libraryFolderId: plan.destination.libraryFolderId, folderPath: plan.destination.folderPath, libraryId: plan.libraryId },
            targetFileUpdates: this.fileUpdates(step, plan, stats, true),
            sourceFileUpdates: this.fileUpdates(step, plan, stats, false),
            droppedSidecarFileIds: step.droppedSidecarFileIds,
            fieldSources: new Map(Object.entries(plan.fieldSources) as Array<[BookMergeField, number]>),
            excludeTagIds: plan.excludeTagIds,
            excludeGenreIds: plan.excludeGenreIds,
            hiddenRequestIds: plan.hiddenRequestIds,
            mergedByUserId: job.requestedByUserId,
            jobId: job.id,
          });
          outcome.status = 'merged';
          processed += 1;
          storedReaders[String(step.sourceBookId)] = {
            affectedUserIds: consolidated.affectedUserIds,
            ratingChangedUserIds: consolidated.ratingChangedUserIds,
            koboEntitlementMovedUserIds: consolidated.koboEntitlementMovedUserIds,
          };
          const jobPlan = { ...(job.plan as object), coverSlots: storedSlots, readers: storedReaders };
          await this.repository.updateJob(job.id, { status: 'committed', moves: [], outcomes, processed, plan: jobPlan }, tx);
          return consolidated;
        });
        merged.push({ sourceBookId: step.sourceBookId, result });
        onProgress({ status: 'committed', currentSourceBookId: step.sourceBookId, processed, outcomes, bytesDone, bytesTotal });
      } catch (error) {
        outcome.status = 'pending';
        const code = error instanceof BookMergeStepError ? error.code : 'MERGE_FAILED';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[${MERGE_EVENT}] [fail] jobId=${job.id} sourceBookId=${step.sourceBookId} errorCode=${code} ` +
            `errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - merge step failed, moving files back`,
        );
        const unresolved = await this.rollback(job.id, journal);
        outcome.status = unresolved.length === 0 ? 'rolled_back' : 'failed';
        outcome.errorCode = code;
        const failedPaths = unresolved.map((move) => `${move.to} -> ${move.from}`).join('; ');
        await this.repository.updateJob(job.id, {
          status: unresolved.length === 0 ? 'rolled_back' : 'failed',
          outcomes,
          errorCode: code,
          error: unresolved.length === 0 ? sanitizeLogValue(message) : sanitizeLogValue(`${message}; not restored: ${failedPaths}`),
          moves: unresolved.length === 0 ? [] : journal,
        });
        return { outcomes, merged, movedFileCount, crossDevice, rolledBack: unresolved.length === 0, failed: unresolved.length > 0, errorCode: code };
      }
    }

    for (const step of plan.steps) {
      const folders = new Set([...step.moves.filter((move) => move.kind === 'move').map((move) => dirname(move.from)), ...step.vacatedFolders]);
      for (const folder of folders) {
        const root = step.roots.find((candidate) => isInsideRoot(candidate, folder));
        if (root) await removeEmptyDirs(folder, root);
      }
    }
    return { outcomes, merged, movedFileCount, crossDevice, rolledBack: false, failed: false, errorCode: null };
  }

  private async moveFiles(
    jobId: number,
    step: MergeStep,
    journal: BookMergeJobMove[],
    onCopyProgress: (copiedBytes: number) => void,
    onMoved: (bytes: number) => void,
  ): Promise<Map<number, { size: number; mtime: Date; ino: bigint }>> {
    const stats = new Map<number, { size: number; mtime: Date; ino: bigint }>();
    for (const move of step.moves) {
      // Checked before the move is journaled: rollback removes whatever sits at a started move's target.
      const current = await stat(move.from).catch(() => null);
      if (!current) throw new BookMergeStepError('FILE_CHANGED', `A file to merge is gone: ${move.from}`);
      if (current.size !== move.expectedSize || Math.trunc(current.mtimeMs) !== move.expectedMtimeMs) {
        throw new BookMergeStepError('FILE_CHANGED', `A file changed after the preview: ${move.from}`);
      }
      if (await pathExists(move.to)) throw new BookMergeStepError('PATH_CONFLICT', `The destination path is taken: ${move.to}`);

      const entry: BookMergeJobMove = {
        fileId: move.fileId,
        from: move.from,
        to: move.to,
        phase: 'started',
        expectedSize: move.expectedSize,
        expectedMtimeMs: move.expectedMtimeMs,
      };
      journal.push(entry);
      await this.repository.setMoves(jobId, journal);

      const outcome = await moveFile(move.from, move.to, move.kind === 'move' ? onCopyProgress : undefined);
      if (move.kind === 'move') onMoved(outcome.stat.sizeBytes);
      entry.phase = 'done';
      entry.movedSize = outcome.stat.sizeBytes;
      entry.movedMtimeMs = outcome.stat.mtime.getTime();
      entry.movedIno = outcome.stat.ino.toString();
      await this.repository.setMoves(jobId, journal);
      stats.set(move.fileId, { size: outcome.stat.sizeBytes, mtime: outcome.stat.mtime, ino: outcome.stat.ino });
    }
    return stats;
  }

  private fileUpdates(
    step: MergeStep,
    plan: MergeExecutionPlan,
    stats: Map<number, { size: number; mtime: Date; ino: bigint }>,
    target: boolean,
  ): FileRowUpdate[] {
    return step.moves
      .filter((move) => move.kind === 'move' && (move.bookId === plan.targetBookId) === target)
      .map((move) => {
        const moved = stats.get(move.fileId);
        return { fileId: move.fileId, absolutePath: move.to, relPath: move.relPath, sizeBytes: moved?.size, mtime: moved?.mtime, ino: moved?.ino };
      });
  }

  /** Moves a failed step's files back, newest first. Returns the entries it could not restore. */
  async rollback(jobId: number, journal: BookMergeJobMove[]): Promise<BookMergeJobMove[]> {
    const unresolved: BookMergeJobMove[] = [];
    for (const entry of [...journal].reverse()) {
      const restored = await this.restore(entry);
      if (!restored) {
        unresolved.push(entry);
        this.logger.error(
          `[${MERGE_EVENT}] [fail] jobId=${jobId} from="${sanitizeLogValue(entry.to)}" to="${sanitizeLogValue(entry.from)}" - file could not be moved back`,
        );
      }
    }
    return unresolved;
  }

  /** 01-architecture.md 3.5: put one journaled move back, or prove there is nothing to undo. */
  private async restore(entry: BookMergeJobMove): Promise<boolean> {
    const from = await stat(entry.from).catch(() => null);
    const to = await stat(entry.to).catch(() => null);
    try {
      if (entry.phase === 'done') {
        if (!to) return from !== null;
        if (from) return false;
        if (entry.movedSize !== undefined && to.size !== entry.movedSize) return false;
        await moveFileBack(entry.to, entry.from);
        return true;
      }
      // Started: the move may be partial. An intact source means whatever is at `to` is ours to remove.
      if (from && from.size === entry.expectedSize) {
        if (to) await unlink(entry.to);
        return true;
      }
      if (!from && to && to.size === entry.expectedSize) {
        await moveFileBack(entry.to, entry.from);
        return true;
      }
      // The move never started; anything else is ambiguous and left for a person.
      return from !== null && to === null;
    } catch {
      return false;
    }
  }
}
