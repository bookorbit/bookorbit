import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import type { BookMergeSourceOutcome } from '@bookorbit/types';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookMergeJobMove } from '../../db/schema';
import { BookMergeEffectsService } from './book-merge-effects.service';
import { BookMergeExecutor, storedReadersOf } from './book-merge.executor';
import { libraryIdsOf, type MergeExecutionPlan } from './book-merge.planner';
import { BookMergeRepository, type MergeJobRow } from './book-merge.repository';

const MERGE_EVENT = 'book_merge';

/**
 * Finishes or undoes merges a restart interrupted (01-architecture.md 3.5). It runs in
 * `onModuleInit`, which Nest completes before any `onApplicationBootstrap`, where the file watcher
 * and the startup scan begin, so neither ever sees a half-moved book.
 */
@Injectable()
export class BookMergeRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(BookMergeRecoveryService.name);

  constructor(
    private readonly repository: BookMergeRepository,
    private readonly executor: BookMergeExecutor,
    private readonly effects: BookMergeEffectsService,
    private readonly libraryGate: LibraryOperationGate,
  ) {}

  async onModuleInit(): Promise<void> {
    let jobs: MergeJobRow[];
    try {
      jobs = await this.repository.findUnfinishedJobs();
    } catch (error) {
      this.logger.warn(
        `[${MERGE_EVENT}] [fail] phase=recovery error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - could not read unfinished merges`,
      );
      return;
    }
    for (const job of jobs) await this.recover(job);
  }

  async recover(job: MergeJobRow): Promise<void> {
    const plan = job.plan as unknown as MergeExecutionPlan;
    // A job from before merges spanned libraries has no list: it touched its own library only.
    const release = this.libraryGate.tryAcquireAll(job.libraryIds ?? libraryIdsOf(plan), 'book_merge');
    try {
      // From the plan, not the stored outcomes: a job interrupted before its first commit may have none.
      const stored = new Map((job.outcomes as BookMergeSourceOutcome[]).map((outcome) => [outcome.sourceBookId, outcome]));
      const outcomes: BookMergeSourceOutcome[] = plan.steps.map((step) => ({
        ...(stored.get(step.sourceBookId) ?? { sourceBookId: step.sourceBookId, status: 'pending', errorCode: null }),
      }));
      if (job.status === 'planned') {
        await this.repository.updateJob(job.id, { status: 'failed', errorCode: 'INTERRUPTED', finishedAt: new Date() });
        this.logger.warn(`[${MERGE_EVENT}] [fail] jobId=${job.id} phase=recovery status=planned - interrupted before it started`);
        return;
      }

      let unresolved: BookMergeJobMove[] = [];
      if (job.status === 'moving' || job.status === 'committing') {
        unresolved = await this.executor.rollback(job.id, job.moves);
        const current = outcomes.find((outcome) => outcome.sourceBookId === job.currentSourceBookId);
        if (current) {
          current.status = unresolved.length === 0 ? 'rolled_back' : 'failed';
          current.errorCode = 'INTERRUPTED';
        }
      }

      const mergedSourceIds = outcomes.filter((outcome) => outcome.status === 'merged').map((outcome) => outcome.sourceBookId);
      // Each step's readers are stored in the transaction that commits it, so a committed source always has them.
      const readers = storedReadersOf(job.plan, mergedSourceIds);
      await this.effects.apply({
        job,
        plan,
        mergedSourceIds,
        affectedUserIds: readers?.affectedUserIds ?? null,
        ratingChangedUserIds: readers?.ratingChangedUserIds ?? null,
        koboEntitlementMovedUserIds: readers?.koboEntitlementMovedUserIds ?? null,
      });

      const allMerged = plan.steps.every((step) => mergedSourceIds.includes(step.sourceBookId));
      const status = unresolved.length > 0 ? 'failed' : allMerged ? 'done' : 'rolled_back';
      await this.repository.updateJob(job.id, {
        status,
        outcomes,
        moves: unresolved,
        currentSourceBookId: null,
        errorCode: allMerged && unresolved.length === 0 ? null : 'INTERRUPTED',
        error: unresolved.length > 0 ? sanitizeLogValue(unresolved.map((move) => `${move.to} -> ${move.from}`).join('; ')) : null,
        finishedAt: new Date(),
      });
      this.logger.log(
        `[${MERGE_EVENT}] [end] jobId=${job.id} phase=recovery status=${status} mergedCount=${mergedSourceIds.length} unresolvedMoves=${unresolved.length} - interrupted merge recovered`,
      );
    } catch (error) {
      this.logger.error(
        `[${MERGE_EVENT}] [fail] jobId=${job.id} phase=recovery errorClass=${error instanceof Error ? error.name : 'Error'} ` +
          `error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - recovery failed`,
      );
    } finally {
      release?.();
    }
  }
}
