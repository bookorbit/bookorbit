import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  BookMergeBlocker,
  BookMergeJob,
  BookMergeJobEvent,
  BookMergeJobResult,
  BookMergeJobStatus,
  BookMergePreviewResponse,
  BookMergeSourceOutcome,
  BookMergeStartResponse,
} from '@bookorbit/types';

import { LibraryOperationGate, type LibraryOperationLease, type LibraryOperationRelease } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ScanGateway } from '../scanner/scan.gateway';
import { BookMergeEffectsService } from './book-merge-effects.service';
import { BookMergeExecutor, type MergeProgress, type MergeRunResult } from './book-merge.executor';
import { BookMergePlanner, libraryIdsOf, type MergeExecutionPlan, type PlanRequest } from './book-merge.planner';
import { BookMergeRepository, type MergeJobRow } from './book-merge.repository';
import type { BookMergeDto, BookMergePreviewDto } from './dto/book-merge.dto';

const MERGE_EVENT = 'book_merge';

/** How a merge run inside a held gate ended. `blocked` means the planner refused it and nothing ran. */
export interface LeasedMergeResult {
  jobId: number | null;
  status: BookMergeJobStatus | 'blocked';
  blockers: BookMergeBlocker[];
  outcomes: BookMergeSourceOutcome[];
  errorCode: string | null;
}
/** Merges running at once across all libraries. A waiting job keeps its library's gate. */
const MAX_RUNNING_JOBS = 2;

@Injectable()
export class BookMergeService {
  private readonly logger = new Logger(BookMergeService.name);
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly repository: BookMergeRepository,
    private readonly planner: BookMergePlanner,
    private readonly executor: BookMergeExecutor,
    private readonly effects: BookMergeEffectsService,
    private readonly libraryGate: LibraryOperationGate,
    private readonly gateway: ScanGateway,
  ) {}

  async preview(dto: BookMergePreviewDto, user: RequestUser): Promise<BookMergePreviewResponse> {
    return (await this.planner.plan(dto, user)).preview;
  }

  async start(dto: BookMergeDto, user: RequestUser): Promise<BookMergeStartResponse> {
    const inFlight = await this.repository.findInFlightJob(user.id, dto.targetBookId, dto.sourceBookIds);
    if (inFlight) {
      throw new ConflictException({ message: 'This merge is already running.', errorCode: 'MERGE_IN_PROGRESS', errorMeta: { jobId: inFlight.id } });
    }

    const { preview, plan } = await this.planner.plan(dto, user);
    if (!plan) {
      if (preview.blockers.some((blocker) => blocker.code === 'LIBRARY_BUSY')) {
        throw new ConflictException({ message: 'Another operation is running in this library.', errorCode: 'LIBRARY_BUSY' });
      }
      throw new ConflictException({
        message: 'These books cannot be merged.',
        errorCode: 'MERGE_BLOCKED',
        errorMeta: { blockers: preview.blockers },
      });
    }
    if (preview.previewToken !== dto.previewToken) {
      throw new ConflictException({ message: 'The books changed since the preview.', errorCode: 'MERGE_PREVIEW_STALE' });
    }
    if (preview.warnings.some((warning) => warning.code === 'LIBRARY_ACCESS_NARROWS') && dto.acknowledgeAccessLoss !== true) {
      throw new ConflictException({
        message: 'Other readers would lose access to this book. Confirm it to merge anyway.',
        errorCode: 'ACCESS_LOSS_NOT_ACKNOWLEDGED',
      });
    }

    // Refused, never queued: a merge waiting behind a scan would run on a plan the scan made stale.
    const libraryIds = libraryIdsOf(plan);
    const release = this.libraryGate.tryAcquireAll(libraryIds, 'book_merge');
    if (!release) throw new ConflictException({ message: 'Another operation is running in this library.', errorCode: 'LIBRARY_BUSY' });

    let job: MergeJobRow;
    try {
      job = await this.repository.createJob({
        libraryId: plan.libraryId,
        libraryIds,
        targetBookId: plan.targetBookId,
        destinationBookId: plan.destinationBookId,
        sourceBookIds: dto.sourceBookIds,
        requestedByUserId: user.id,
        status: 'planned',
        plan: plan as unknown as Record<string, unknown>,
        total: plan.steps.length,
      });
    } catch (error) {
      release();
      throw error;
    }

    this.logger.log(
      `[${MERGE_EVENT}] [start] jobId=${job.id} libraryId=${plan.libraryId} libraryIds=${libraryIds.join(',')} targetBookId=${plan.targetBookId} ` +
        `sourceCount=${plan.steps.length} destination=${plan.destinationBookId} userId=${user.id} - merge started`,
    );
    void this.runJob(job, plan, user.id, release);
    return { jobId: job.id, libraryIds };
  }

  /**
   * Plans and runs one merge inside a longer run that already holds the library gate (a bulk
   * duplicate resolution). Nobody reviewed this exact plan, so there is no preview token to check;
   * the planner's blockers still apply. Resolves once the merge has finished. The gate is neither
   * taken nor released here.
   */
  async mergeWithinLease(request: PlanRequest, user: RequestUser, lease: LibraryOperationLease): Promise<LeasedMergeResult> {
    const blocked = (blockers: BookMergeBlocker[], errorCode: string | null, jobId: number | null = null): LeasedMergeResult => ({
      jobId,
      status: 'blocked',
      blockers,
      outcomes: [],
      errorCode,
    });
    const inFlight = await this.repository.findInFlightJob(user.id, request.targetBookId, request.sourceBookIds);
    if (inFlight) return blocked([], 'MERGE_IN_PROGRESS', inFlight.id);

    const { preview, plan } = await this.planner.plan(request, user, { lease });
    if (!plan) return blocked(preview.blockers, 'MERGE_BLOCKED');
    const libraryIds = libraryIdsOf(plan);
    const unheld = libraryIds.find((id) => !lease.holds(id));
    if (unheld !== undefined) return blocked([{ code: 'LIBRARY_BUSY', libraryId: unheld }], 'LIBRARY_BUSY');
    // Nobody confirmed this exact plan, so nobody agreed to other readers losing the book.
    if (preview.warnings.some((warning) => warning.code === 'LIBRARY_ACCESS_NARROWS')) {
      return blocked([{ code: 'READERS_LOSE_ACCESS', libraryId: plan.libraryId }], 'MERGE_BLOCKED');
    }

    const job = await this.repository.createJob({
      libraryId: plan.libraryId,
      libraryIds,
      targetBookId: plan.targetBookId,
      destinationBookId: plan.destinationBookId,
      sourceBookIds: request.sourceBookIds,
      requestedByUserId: user.id,
      status: 'planned',
      plan: plan as unknown as Record<string, unknown>,
      total: plan.steps.length,
    });
    this.logger.log(
      `[${MERGE_EVENT}] [start] jobId=${job.id} libraryId=${plan.libraryId} libraryIds=${libraryIds.join(',')} targetBookId=${plan.targetBookId} ` +
        `sourceCount=${plan.steps.length} destination=${plan.destinationBookId} userId=${user.id} leased=true - merge started`,
    );
    await this.runJob(job, plan, user.id, () => undefined);

    const finished = await this.repository.findJob(job.id);
    return {
      jobId: job.id,
      status: (finished?.status as BookMergeJobStatus | undefined) ?? 'failed',
      blockers: [],
      outcomes: (finished?.outcomes as BookMergeSourceOutcome[] | undefined) ?? [],
      errorCode: finished?.errorCode ?? null,
    };
  }

  async getJob(jobId: number, user: RequestUser): Promise<BookMergeJob> {
    const job = await this.repository.findJob(jobId);
    if (!job || (!user.isSuperuser && job.requestedByUserId !== user.id)) throw new NotFoundException('Merge job not found');
    return this.toJob(job);
  }

  private async runJob(job: MergeJobRow, plan: MergeExecutionPlan, userId: number, release: LibraryOperationRelease): Promise<void> {
    const startedAt = Date.now();
    await this.acquireSlot();
    try {
      const result = await this.executor.run(job, plan, (change) => this.emitProgress(userId, { ...job, ...change }, 'progress', change));
      const retired = await this.effects.apply({
        job: (await this.repository.findJob(job.id)) ?? job,
        plan,
        mergedSourceIds: result.merged.map((entry) => entry.sourceBookId),
        affectedUserIds: [...new Set(result.merged.flatMap((entry) => entry.result.affectedUserIds))],
        ratingChangedUserIds: [...new Set(result.merged.flatMap((entry) => entry.result.ratingChangedUserIds))],
        koboEntitlementMovedUserIds: [...new Set(result.merged.flatMap((entry) => entry.result.koboEntitlementMovedUserIds))],
      });
      await this.finish(job, plan, userId, result, retired, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${MERGE_EVENT}] [fail] jobId=${job.id} libraryId=${plan.libraryId} targetBookId=${plan.targetBookId} durationMs=${Date.now() - startedAt} ` +
          `errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - merge failed`,
      );
      await this.repository
        .updateJob(job.id, { status: 'failed', errorCode: 'MERGE_FAILED', error: sanitizeLogValue(message), finishedAt: new Date() })
        .catch(() => undefined);
      const failed = await this.repository.findJob(job.id).catch(() => null);
      if (failed) this.emitProgress(userId, failed, 'finished');
    } finally {
      this.releaseSlot();
      release();
    }
  }

  private async finish(
    job: MergeJobRow,
    plan: MergeExecutionPlan,
    userId: number,
    run: MergeRunResult,
    retired: number,
    startedAt: number,
  ): Promise<void> {
    const status: BookMergeJobStatus = run.failed ? 'failed' : run.rolledBack ? 'rolled_back' : 'done';
    const result: BookMergeJobResult = {
      movedFileCount: run.movedFileCount,
      crossDevice: run.crossDevice,
      leftoverFileCount: 0,
      retiredFileCount: retired,
    };
    await this.repository.updateJob(job.id, {
      status,
      outcomes: run.outcomes,
      result: result as unknown as Record<string, unknown>,
      currentSourceBookId: null,
      finishedAt: new Date(),
    });

    const mergedSourceIds = run.merged.map((entry) => entry.sourceBookId);
    if (mergedSourceIds.length > 0) {
      this.gateway.emitBookMerged({
        libraryId: plan.libraryId,
        targetBookId: plan.targetBookId,
        sourceBookIds: mergedSourceIds,
        sourceLibraryIds: libraryIdsOf(plan).filter((id) => id !== plan.libraryId),
      });
    }
    const finished = await this.repository.findJob(job.id);
    if (finished) this.emitProgress(userId, finished, 'finished');

    const line =
      `jobId=${job.id} libraryId=${plan.libraryId} targetBookId=${plan.targetBookId} sourceCount=${plan.steps.length} ` +
      `mergedCount=${mergedSourceIds.length} movedFiles=${run.movedFileCount} crossDevice=${run.crossDevice} retiredFiles=${retired} durationMs=${Date.now() - startedAt}`;
    if (status === 'done') this.logger.log(`[${MERGE_EVENT}] [end] ${line} - merge finished`);
    else this.logger.warn(`[${MERGE_EVENT}] [fail] ${line} errorCode=${run.errorCode ?? 'none'} status=${status} - merge stopped`);
  }

  private emitProgress(
    userId: number,
    job: MergeJobRow,
    phase: 'progress' | 'finished',
    bytes?: Pick<MergeProgress, 'bytesDone' | 'bytesTotal'>,
  ): void {
    const event: BookMergeJobEvent = {
      jobId: job.id,
      status: job.status as BookMergeJobStatus,
      targetBookId: job.targetBookId,
      processed: job.processed,
      total: job.total,
      currentSourceBookId: job.currentSourceBookId,
      outcomes: job.outcomes as BookMergeSourceOutcome[],
      ...(bytes?.bytesTotal !== undefined ? { bytesTotal: bytes.bytesTotal, bytesDone: bytes.bytesDone ?? 0 } : {}),
    };
    this.gateway.emitBookMergeJob(userId, phase, event);
  }

  private toJob(job: MergeJobRow): BookMergeJob {
    return {
      id: job.id,
      libraryId: job.libraryId,
      targetBookId: job.targetBookId,
      sourceBookIds: job.sourceBookIds,
      status: job.status as BookMergeJobStatus,
      processed: job.processed,
      total: job.total,
      currentSourceBookId: job.currentSourceBookId,
      outcomes:
        (job.outcomes as BookMergeSourceOutcome[]).length > 0
          ? (job.outcomes as BookMergeSourceOutcome[])
          : job.sourceBookIds.map((sourceBookId) => ({ sourceBookId, status: 'pending', errorCode: null })),
      result: (job.result as BookMergeJobResult | null) ?? null,
      errorCode: job.errorCode,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    };
  }

  private async acquireSlot(): Promise<void> {
    if (this.running < MAX_RUNNING_JOBS) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }
}
