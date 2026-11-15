import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { stat } from 'fs/promises';

import type {
  BookMoveCollisionPolicy,
  BookMoveJobCollisionPolicy,
  BookMoveLayoutChange,
  BookMovePreviewCollisionItem,
  BookMovePreviewIneligibleItem,
  BookMovePreviewReadyItem,
  BookMovePreviewResult,
  BookMoveProgressEvent,
  BookMoveSummary,
  BookMoveWarnings,
  OrganizationMode,
} from '@bookorbit/types';
import { BOOK_MOVE_DETAIL_LIMIT, BOOK_MOVE_PREVIEW_SAMPLE_LIMIT, NotificationType } from '@bookorbit/types';

import { LibraryOperationGate, type LibraryOperationRelease } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BulkRunRow } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import type { BulkItemOutcome, BulkRunEnd } from '../bulk-runs/bulk-run-handler';
import { BookService } from '../book/book.service';
import { NotificationService } from '../notification/notification.service';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { ScanGateway } from '../scanner/scan.gateway';
import { ScannerService } from '../scanner/scanner.service';
import { BookMoveExecutorService } from './book-move-executor.service';
import type { BookMovePlan, BookMovePlanOutcome, PlanCollision } from './book-move-planner.service';
import { BookMovePlannerService } from './book-move-planner.service';
import type { MoveBookData, MoveTargetLibrary } from './book-move.repository';
import { BookMoveRepository } from './book-move.repository';
import type { MoveBooksDto, MovePreviewDto } from './dto/move-books.dto';

const MOVE_EVENT = 'book_move.job';
const MAX_PLAN_ROUNDS = 5;

/** What a move run keeps to rebuild its plan when it starts, and again on Continue. */
export type BookMoveRunOptions = {
  targetLibraryId: number;
  targetFolderId: number;
  collisionPolicy: BookMoveJobCollisionPolicy;
  /** Only the overrides for books in the run. */
  overrides: { bookId: number; policy: BookMoveCollisionPolicy }[];
  /** The source libraries when the run was created; the gate is taken on these before replanning. */
  sourceLibraryIds: number[];
};

export interface BookMoveRunPlan {
  /** The books the move will work through, in plan order. */
  subjectIds: number[];
  options: BookMoveRunOptions;
}

interface MoveSkip {
  code: string;
  reason: string;
}

interface MoveWork {
  plan: BookMovePlan;
  mergeDuplicateBookId: number | null;
  /** Set when the collision policy cannot be applied to this book. */
  skip?: MoveSkip;
}

/** A started move run: the libraries it holds, its plan for the books still to do, and its tallies. */
export interface BookMoveRunState {
  runId: string;
  jobId: number;
  userId: number;
  target: MoveTargetLibrary;
  work: Map<number, MoveWork>;
  /** Books the replanned run will not move, and why. */
  skips: Map<number, MoveSkip>;
  releaseGate: LibraryOperationRelease;
  stoppedWatchers: number[];
  movedByLibrary: Map<number, number[]>;
  /** This start's tallies for the `book_move_jobs` row; the run row keeps the totals. */
  counts: { succeeded: number; merged: number; failed: number; skipped: number };
  /** The libraries the acting account may edit, for the actor they were read for. */
  editable: { actor: RequestUser; ids: Set<number> };
  startedAt: number;
}

interface ResolvedPlan {
  target: MoveTargetLibrary;
  outcomes: BookMovePlanOutcome[];
  totalSelected: number;
  sourceLibraryIds: number[];
}

/** Rebuilds the route's final event from the settled run; `succeeded` there leaves merges out. */
export function bookMoveDoneEvent(
  run: Pick<BulkRunRow, 'status' | 'processed' | 'succeeded' | 'failed' | 'skipped' | 'stats'>,
): BookMoveProgressEvent {
  const merged = Math.max(0, Math.trunc(Number(run.stats?.merged ?? 0)) || 0);
  const summary: BookMoveSummary = {
    processed: run.processed,
    succeeded: Math.max(0, run.succeeded - merged),
    merged,
    failed: run.failed,
    skipped: run.skipped,
    cancelled: run.status === 'cancelled',
  };
  return { done: true, ...summary };
}

function isLibraryId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

@Injectable()
export class BookMoveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookMoveService.name);
  /** Set once the boot check for moves cut short by a restart has run. */
  private bootRecoveryDone = false;
  /** Libraries rescanned at boot because a move was cut short in them; each leaves once its scan ends. */
  private readonly bootRescans = new Set<number>();

  constructor(
    private readonly moveRepo: BookMoveRepository,
    private readonly planner: BookMovePlannerService,
    private readonly executor: BookMoveExecutorService,
    private readonly bookService: BookService,
    private readonly appSettings: AppSettingsService,
    private readonly scannerService: ScannerService,
    private readonly fileWatcherService: FileWatcherService,
    private readonly scanGateway: ScanGateway,
    private readonly notificationService: NotificationService,
    private readonly libraryGate: LibraryOperationGate,
    private readonly libraryScope: LibraryScopeService,
  ) {}

  /**
   * Job progress is in-memory like every other bulk job, so a crash leaves a row
   * behind. Repair the affected libraries immediately rather than waiting for the
   * watcher's half-hourly reconcile.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const interrupted = await this.moveRepo.markInterruptedJobs().catch((error: Error) => {
        this.logger.warn(`[${MOVE_EVENT}] [fail] error="${sanitizeLogValue(error.message)}" - could not check for interrupted move jobs`);
        return [];
      });

      if (interrupted.length === 0) return;

      const libraryIds = [...new Set(interrupted.flatMap((job) => job.libraryIds))];
      this.logger.warn(
        `[${MOVE_EVENT}] [fail] jobCount=${interrupted.length} libraryIds=${libraryIds.join(',')} - move jobs interrupted by restart, rescanning affected libraries`,
      );

      for (const libraryId of libraryIds) {
        this.bootRescans.add(libraryId);
        this.scannerService.startScanAsync(libraryId);
      }
    } finally {
      this.bootRecoveryDone = true;
    }
  }

  /**
   * Whether an interrupted move run may continue: not before the boot check ran, nor while one of
   * its libraries is still being rescanned after the restart.
   */
  isContinuable(run: Pick<BulkRunRow, 'options'>): boolean {
    if (!this.bootRecoveryDone) return false;
    const options = (run.options ?? {}) as Partial<BookMoveRunOptions>;
    const libraryIds = [options.targetLibraryId, ...(Array.isArray(options.sourceLibraryIds) ? options.sourceLibraryIds : [])].filter(isLibraryId);
    const checked = libraryIds.length > 0 ? libraryIds : [...this.bootRescans];
    return checked.every((libraryId) => !this.bootRescanPending(libraryId));
  }

  /** The boot scan takes the library's gate as it starts, so a free gate means it has ended. */
  private bootRescanPending(libraryId: number): boolean {
    if (!this.bootRescans.has(libraryId)) return false;
    if (this.libraryGate.isHeld(libraryId) || this.scannerService.isScanRunning(libraryId)) return true;
    this.bootRescans.delete(libraryId);
    return false;
  }

  isBusy(libraryId: number): boolean {
    return this.libraryGate.current(libraryId) === 'book_move';
  }

  async preview(dto: MovePreviewDto, user: RequestUser): Promise<BookMovePreviewResult> {
    const resolved = await this.resolvePlan(dto, user);
    return this.buildPreview(resolved);
  }

  /**
   * Checks a move before it is queued, as the route always has: the target exists, the account
   * edits every library involved, and no scan or other operation holds one of them now. Answers
   * the books the run will work through and what it needs to plan them again when it starts.
   */
  async planRun(dto: MoveBooksDto, user: RequestUser): Promise<BookMoveRunPlan> {
    const resolved = await this.resolvePlan(dto, user);
    const involvedLibraryIds = [...new Set([resolved.target.libraryId, ...resolved.sourceLibraryIds])];
    // Only a check: the run takes the gate when it starts, and waits in line while a library is held.
    this.acquireLibraries(involvedLibraryIds)();

    const overrides = new Map((dto.overrides ?? []).map((override) => [override.bookId, override.policy]));
    const subjectIds = this.selectWork(resolved.outcomes, dto.collisionPolicy, overrides).map((item) => item.plan.bookId);
    const inRun = new Set(subjectIds);
    return {
      subjectIds,
      options: {
        targetLibraryId: resolved.target.libraryId,
        targetFolderId: resolved.target.folderId,
        collisionPolicy: dto.collisionPolicy,
        overrides: [...overrides].filter(([bookId]) => inRun.has(bookId)).map(([bookId, policy]) => ({ bookId, policy })),
        sourceLibraryIds: resolved.sourceLibraryIds,
      },
    };
  }

  /**
   * Starts or continues a move run: takes the gate on its libraries, plans the books still to do
   * again (some may have moved, gone or changed since the run was queued), stops the watchers and
   * opens the `book_move_jobs` row the boot check repairs from. Answers `busy` while a library is held.
   */
  async prepareRun(run: BulkRunRow, actor: RequestUser): Promise<{ state: BookMoveRunState } | 'busy'> {
    const options = run.options as Partial<BookMoveRunOptions>;
    if (!isLibraryId(options.targetLibraryId) || !isLibraryId(options.targetFolderId)) {
      throw new BadRequestException('The move run has no target library folder');
    }
    const initial = [
      ...new Set([options.targetLibraryId, ...(Array.isArray(options.sourceLibraryIds) ? options.sourceLibraryIds : [])].filter(isLibraryId)),
    ];
    const releaseInitial = this.libraryGate.tryAcquireAll(initial, 'book_move');
    if (!releaseInitial) return 'busy';

    const releases: LibraryOperationRelease[] = [releaseInitial];
    const releaseGate: LibraryOperationRelease = () => {
      for (const release of releases) release();
    };
    const stoppedWatchers: number[] = [];
    let jobId: number | null = null;
    try {
      const target = await this.moveRepo.findTargetLibrary(options.targetLibraryId, options.targetFolderId);
      if (!target) throw new NotFoundException('Target library folder not found');
      const editable = new Set(await this.libraryScope.editableIds(actor));
      if (!editable.has(target.libraryId)) throw new ForbiddenException(`Editor access is required for library ${target.libraryId} to move books`);

      const remaining = run.subjectIds.slice(run.processed);
      const found = new Map((await this.moveRepo.findMoveBookData(remaining)).map((book) => [book.bookId, book]));
      const skips = new Map<number, MoveSkip>();
      const reachable: MoveBookData[] = [];
      for (const bookId of remaining) {
        const book = found.get(bookId);
        if (!book) skips.set(bookId, { code: 'not-found', reason: 'book no longer exists' });
        else if (!editable.has(book.libraryId)) skips.set(bookId, { code: 'no-access', reason: 'no editor access to the source library' });
        else reachable.push(book);
      }

      // A book that changed library while the run waited brings its new library under the gate too.
      const extra = [...new Set(reachable.map((book) => book.libraryId))].filter((libraryId) => !initial.includes(libraryId));
      if (extra.length > 0) {
        const releaseExtra = this.libraryGate.tryAcquireAll(extra, 'book_move');
        if (!releaseExtra) {
          releaseGate();
          return 'busy';
        }
        releases.push(releaseExtra);
      }
      const held = [...new Set([...initial, ...extra])];

      const outcomes = await this.planBooks(target, reachable);
      const overrides = new Map((options.overrides ?? []).map((override) => [override.bookId, override.policy]));
      const work = new Map<number, MoveWork>();
      for (const item of this.selectWork(outcomes, options.collisionPolicy ?? 'suggested', overrides)) work.set(item.plan.bookId, item);
      for (const outcome of outcomes) {
        const bookId = outcome.kind === 'ready' || outcome.kind === 'collision' ? outcome.plan.bookId : outcome.bookId;
        if (work.has(bookId) || skips.has(bookId)) continue;
        if (outcome.kind === 'already_in_target') skips.set(bookId, { code: 'already-in-target', reason: 'already in the target folder' });
        else if (outcome.kind === 'ineligible') {
          skips.set(bookId, { code: 'ineligible', reason: outcome.detail ? `${outcome.reason}: ${outcome.detail}` : outcome.reason });
        } else skips.set(bookId, { code: 'collision-skipped', reason: 'skipped by the collision policy' });
      }

      const sourceLibraryIds = held.filter((libraryId) => libraryId !== target.libraryId);
      jobId = await this.moveRepo.createJob({
        startedBy: actor.id,
        targetLibraryId: target.libraryId,
        targetFolderId: target.folderId,
        sourceLibraryIds,
        totalBooks: remaining.length,
      });

      this.logger.log(
        `[${MOVE_EVENT}] [start] runId=${run.id} jobId=${jobId} userId=${actor.id} toLibraryId=${target.libraryId} toFolderId=${target.folderId} ` +
          `sourceLibraryIds=${sourceLibraryIds.join(',')} bookCount=${remaining.length} resumeAt=${run.processed} - book move started`,
      );

      await this.stopWatchers(held, stoppedWatchers);

      return {
        state: {
          runId: run.id,
          jobId,
          userId: actor.id,
          target,
          work,
          skips,
          releaseGate,
          stoppedWatchers,
          movedByLibrary: new Map(),
          counts: { succeeded: 0, merged: 0, failed: 0, skipped: 0 },
          editable: { actor, ids: editable },
          startedAt: Date.now(),
        },
      };
    } catch (error) {
      if (jobId !== null) {
        await this.moveRepo
          .finishJob(jobId, 'failed', { succeeded: 0, merged: 0, failed: 0, skipped: 0 }, getErrorMessage(error))
          .catch(() => undefined);
      }
      releaseGate();
      await this.restartWatchers(stoppedWatchers);
      throw error;
    }
  }

  /** Moves one book of a started run and answers the route's per-book event for it. */
  async moveOne(bookId: number, state: BookMoveRunState, actor: RequestUser): Promise<BulkItemOutcome> {
    const skip = (code: string, reason: string): BulkItemOutcome => {
      state.counts.skipped++;
      return { outcome: 'skipped', code, event: { bookId, status: 'skipped', reason } satisfies BookMoveProgressEvent };
    };

    const planned = state.skips.get(bookId);
    if (planned) return skip(planned.code, planned.reason);
    const item = state.work.get(bookId);
    if (!item) return skip('not-found', 'book no longer exists');

    const editable = await this.editableFor(state, actor);
    if (!editable.has(state.target.libraryId)) return skip('no-access', 'no editor access to the target library');
    if (!editable.has(item.plan.sourceLibraryId)) return skip('no-access', 'no editor access to the source library');
    if (item.skip) return skip(item.skip.code, item.skip.reason);

    const fail = (reason: string): BulkItemOutcome => {
      state.counts.failed++;
      return { outcome: 'failed', code: 'move-failed', message: reason, event: { bookId, status: 'failed', reason } satisfies BookMoveProgressEvent };
    };

    try {
      const result = await this.executor.execute({
        plan: item.plan,
        target: state.target,
        mergeDuplicateBookId: item.mergeDuplicateBookId,
        userId: state.userId,
      });

      if (result.status === 'success' || result.status === 'merged') {
        if (result.status === 'merged') state.counts.merged++;
        else state.counts.succeeded++;

        const list = state.movedByLibrary.get(item.plan.sourceLibraryId);
        if (list) list.push(bookId);
        else state.movedByLibrary.set(item.plan.sourceLibraryId, [bookId]);

        return {
          outcome: 'succeeded',
          ...(result.status === 'merged' ? { stats: { merged: 1 } } : {}),
          event: { bookId, status: result.status } satisfies BookMoveProgressEvent,
        };
      }
      if (result.status === 'skipped') return skip('move-skipped', result.reason);
      return fail(result.reason);
    } catch (error) {
      return fail(getErrorMessage(error));
    }
  }

  /**
   * Ends a started run however it ended: tells the libraries which books left them, closes the
   * `book_move_jobs` row, notifies the requester, frees the libraries and restarts the watchers.
   * A run cancelled or stopped before it started holds nothing, so there is nothing to do.
   */
  async finishRun(run: BulkRunRow, state: BookMoveRunState | null, end: BulkRunEnd): Promise<void> {
    if (!state) return;
    const { counts } = state;
    try {
      this.emitTransfers(state.movedByLibrary, state.target.libraryId);
      if (end === 'failed') {
        const error = run.error ?? run.errorCode ?? 'Move run failed';
        await this.moveRepo.finishJob(state.jobId, 'failed', counts, error);
        this.logger.error(
          `[${MOVE_EVENT}] [fail] runId=${run.id} jobId=${state.jobId} userId=${state.userId} durationMs=${Date.now() - state.startedAt} ` +
            `errorClass=BulkRunFailed code=${run.errorCode ?? 'error'} error="${sanitizeLogValue(error)}" - book move failed`,
        );
        return;
      }

      await this.moveRepo.finishJob(state.jobId, 'completed', counts);
      this.logger.log(
        `[${MOVE_EVENT}] [end] runId=${run.id} jobId=${state.jobId} userId=${state.userId} durationMs=${Date.now() - state.startedAt} succeeded=${counts.succeeded} ` +
          `merged=${counts.merged} failed=${counts.failed} skipped=${counts.skipped} cancelled=${end === 'cancelled'} - book move completed`,
      );
      // The run's totals, so a move continued after a restart reports everything it moved.
      if (run.requestedBy !== null) await this.notifyCompletion(run.requestedBy, state.target, run.succeeded, run.failed);
    } finally {
      state.releaseGate();
      await this.restartWatchers(state.stoppedWatchers);
    }
  }

  /** The libraries the run's account may edit, read again whenever the run refreshed the account. */
  private async editableFor(state: BookMoveRunState, actor: RequestUser): Promise<Set<number>> {
    if (state.editable.actor !== actor) state.editable = { actor, ids: new Set(await this.libraryScope.editableIds(actor)) };
    return state.editable.ids;
  }

  private acquireLibraries(libraryIds: number[]): LibraryOperationRelease {
    const release = this.libraryGate.tryAcquireAll(libraryIds, 'book_move');
    if (release) return release;
    for (const libraryId of libraryIds) {
      const holder = this.libraryGate.current(libraryId);
      if (holder === 'book_move') throw new ConflictException(`A move is already running for library ${libraryId}.`);
      if (holder === 'scan') {
        throw new ConflictException(`A scan is running for library ${libraryId}. Wait for it to finish before moving books.`);
      }
      if (holder) throw new ConflictException(`Another operation is running for library ${libraryId}. Wait for it to finish before moving books.`);
    }
    throw new ConflictException('A library operation is already running.');
  }

  /** Records each library before stopping it, so one whose stop fails part-way is restarted too. */
  private async stopWatchers(libraryIds: number[], stopped: number[]): Promise<void> {
    const watched = await this.moveRepo.findWatchedLibraryIds(libraryIds);
    for (const libraryId of watched) {
      stopped.push(libraryId);
      await this.fileWatcherService.stopWatcher(libraryId);
    }
  }

  private async restartWatchers(libraryIds: number[]): Promise<void> {
    if (libraryIds.length === 0) return;

    const folders = await this.moveRepo.findLibraryFolders(libraryIds);
    const pathsByLibrary = new Map<number, string[]>();
    for (const folder of folders) {
      const list = pathsByLibrary.get(folder.libraryId);
      if (list) list.push(folder.path);
      else pathsByLibrary.set(folder.libraryId, [folder.path]);
    }

    for (const libraryId of libraryIds) {
      await this.fileWatcherService.startWatcher(libraryId, pathsByLibrary.get(libraryId) ?? []).catch((error: Error) => {
        this.logger.error(
          `[${MOVE_EVENT}] [fail] libraryId=${libraryId} error="${sanitizeLogValue(error.message)}" - could not restart watcher after move`,
        );
      });
    }
  }

  private emitTransfers(movedByLibrary: Map<number, number[]>, targetLibraryId: number): void {
    for (const [sourceLibraryId, bookIds] of movedByLibrary) {
      if (bookIds.length === 0) continue;
      this.scanGateway.emitBookTransferred({ fromLibraryId: sourceLibraryId, toLibraryId: targetLibraryId, bookIds });
    }
  }

  private async resolvePlan(dto: MovePreviewDto, user: RequestUser): Promise<ResolvedPlan> {
    const target = await this.moveRepo.findTargetLibrary(dto.targetLibraryId, dto.targetFolderId);
    if (!target) {
      throw new NotFoundException('Target library folder not found');
    }

    const bookIds = await this.bookService.resolveSelectionToIds(dto.selection, user);
    if (bookIds.length === 0) {
      throw new BadRequestException('No books matched the selection');
    }

    const books = await this.moveRepo.findMoveBookData(bookIds);
    const sourceLibraryIds = [...new Set(books.map((book) => book.libraryId))].filter((id) => id !== target.libraryId);

    await this.assertEditorAccess(user, [...new Set([...sourceLibraryIds, target.libraryId])]);

    return { target, outcomes: await this.planBooks(target, books), totalSelected: bookIds.length, sourceLibraryIds };
  }

  private async planBooks(target: MoveTargetLibrary, books: MoveBookData[]): Promise<BookMovePlanOutcome[]> {
    if (books.length === 0) return [];

    const pattern =
      target.fileNamingPattern ??
      (target.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());

    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();

    const candidateHashes: string[] = [];
    for (const book of books) {
      for (const file of book.files) {
        if (file.role === 'content' && file.fileHash) candidateHashes.push(file.fileHash);
      }
    }
    const hashOwners = await this.moveRepo.findHashOwnersInLibrary(target.libraryId, [...new Set(candidateHashes)]);

    // Planning is iterative because resolving a collision invents new destination
    // names ("Dune (2)") that were never looked up. Each round feeds the newly
    // proposed paths back through the database until no unchecked path remains,
    // which normally settles in two rounds.
    const folderPathOwners = new Map<string, number>();
    const filePathOwners = new Map<string, number>();
    const checkedFolderPaths = new Set<string>();
    const checkedFilePaths = new Set<string>();

    let outcomes = this.planner.plan({ books, target, pattern, sanitizeForCrossPlatform, folderPathOwners, filePathOwners, hashOwners });

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      const newFolderPaths = new Set<string>();
      const newFilePaths = new Set<string>();

      const collect = (plan: BookMovePlan): void => {
        if (!checkedFolderPaths.has(plan.targetFolderPathKey)) newFolderPaths.add(plan.targetFolderPathKey);
        for (const file of plan.files) {
          if (!checkedFilePaths.has(file.to)) newFilePaths.add(file.to);
        }
      };

      for (const outcome of outcomes) {
        if (outcome.kind === 'ready') collect(outcome.plan);
        else if (outcome.kind === 'collision') {
          collect(outcome.plan);
          collect(outcome.collision.keepBothPlan);
        }
      }

      if (newFolderPaths.size === 0 && newFilePaths.size === 0) break;

      const [folderOwners, fileOwners] = await Promise.all([
        this.moveRepo.findFolderPathOwners(target.libraryId, [...newFolderPaths]),
        this.moveRepo.findFilePathOwners([...newFilePaths]),
      ]);

      for (const path of newFolderPaths) checkedFolderPaths.add(path);
      for (const path of newFilePaths) checkedFilePaths.add(path);
      for (const [path, bookId] of folderOwners) folderPathOwners.set(path, bookId);
      for (const [path, bookId] of fileOwners) filePathOwners.set(path, bookId);

      outcomes = this.planner.plan({ books, target, pattern, sanitizeForCrossPlatform, folderPathOwners, filePathOwners, hashOwners });
    }

    return outcomes;
  }

  private async assertEditorAccess(user: RequestUser, libraryIds: number[]): Promise<void> {
    if (libraryIds.length === 0) return;

    const granted = new Set(await this.libraryScope.editableIds(user));
    const missing = libraryIds.filter((id) => !granted.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(`Editor access is required for library ${missing[0]} to move books`);
    }
  }

  private selectWork(
    outcomes: BookMovePlanOutcome[],
    jobPolicy: BookMoveJobCollisionPolicy,
    overrides: Map<number, BookMoveCollisionPolicy>,
  ): MoveWork[] {
    const work: MoveWork[] = [];

    for (const outcome of outcomes) {
      if (outcome.kind === 'ready') {
        work.push({ plan: outcome.plan, mergeDuplicateBookId: null });
        continue;
      }
      if (outcome.kind !== 'collision') continue;

      // "suggested" defers to what the planner worked out for this specific
      // collision, so identical copies merge while name-only clashes keep both.
      const jobChoice = jobPolicy === 'suggested' ? outcome.collision.suggestedPolicy : jobPolicy;
      const policy = overrides.get(outcome.plan.bookId) ?? jobChoice;
      const resolvedWork = this.applyCollisionPolicy(outcome.plan, outcome.collision, policy);
      if (resolvedWork) work.push(resolvedWork);
    }

    return work;
  }

  private applyCollisionPolicy(plan: BookMovePlan, collision: PlanCollision, policy: BookMoveCollisionPolicy): MoveWork | null {
    if (policy === 'skip') return null;

    if (policy === 'merge') {
      // Merging replaces the book already in the target library. That is only
      // meaningful when the two hold identical content; for a name-only clash it
      // would delete an unrelated book, so refuse instead of guessing.
      if (collision.kind !== 'hash_duplicate' || collision.existingBookId == null) {
        return { plan, mergeDuplicateBookId: null, skip: { code: 'merge-not-identical', reason: 'merge only applies to identical copies' } };
      }
      return { plan, mergeDuplicateBookId: collision.existingBookId };
    }

    if (collision.keepBothPlan === plan) {
      return { plan, mergeDuplicateBookId: null, skip: { code: 'no-free-name', reason: 'no free destination name found' } };
    }
    return { plan: collision.keepBothPlan, mergeDuplicateBookId: null };
  }

  private async buildPreview(resolved: ResolvedPlan): Promise<BookMovePreviewResult> {
    const { target, outcomes } = resolved;

    const ready: BookMovePreviewReadyItem[] = [];
    const collisions: BookMovePreviewCollisionItem[] = [];
    const ineligible: BookMovePreviewIneligibleItem[] = [];
    let readyCount = 0;
    let alreadyInTargetCount = 0;
    const layoutCounts = new Map<BookMoveLayoutChange, number>();
    const movingPlans: BookMovePlan[] = [];

    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case 'already_in_target':
          alreadyInTargetCount++;
          break;
        case 'ineligible':
          if (ineligible.length < BOOK_MOVE_DETAIL_LIMIT) {
            ineligible.push({ bookId: outcome.bookId, title: outcome.title, reason: outcome.reason, detail: outcome.detail });
          }
          break;
        case 'ready':
          readyCount++;
          movingPlans.push(outcome.plan);
          if (outcome.plan.layoutChange) {
            layoutCounts.set(outcome.plan.layoutChange, (layoutCounts.get(outcome.plan.layoutChange) ?? 0) + 1);
          }
          if (ready.length < BOOK_MOVE_PREVIEW_SAMPLE_LIMIT) {
            ready.push({
              bookId: outcome.plan.bookId,
              title: outcome.plan.title,
              currentPath: outcome.plan.currentPath,
              targetPath: outcome.plan.targetPath,
              layoutChange: outcome.plan.layoutChange,
            });
          }
          break;
        case 'collision':
          movingPlans.push(outcome.plan);
          if (outcome.plan.layoutChange) {
            layoutCounts.set(outcome.plan.layoutChange, (layoutCounts.get(outcome.plan.layoutChange) ?? 0) + 1);
          }
          if (collisions.length < BOOK_MOVE_DETAIL_LIMIT) {
            collisions.push({
              bookId: outcome.plan.bookId,
              title: outcome.plan.title,
              kind: outcome.collision.kind,
              currentPath: outcome.plan.currentPath,
              targetPath: outcome.plan.targetPath,
              existingBookId: outcome.collision.existingBookId,
              suggestedPolicy: outcome.collision.suggestedPolicy,
              keepBothPath: outcome.collision.keepBothPlan.targetPath,
            });
          }
          break;
      }
    }

    const collisionCount = outcomes.filter((outcome) => outcome.kind === 'collision').length;
    const ineligibleCount = outcomes.filter((outcome) => outcome.kind === 'ineligible').length;

    const warnings = await this.buildWarnings(resolved, movingPlans, layoutCounts);

    return {
      targetLibraryId: target.libraryId,
      targetFolderId: target.folderId,
      targetOrganizationMode: target.organizationMode as OrganizationMode,
      totalSelected: resolved.totalSelected,
      readyCount,
      ready,
      alreadyInTargetCount,
      collisionCount,
      collisions,
      collisionsTruncated: collisionCount > collisions.length,
      ineligibleCount,
      ineligible,
      ineligibleTruncated: ineligibleCount > ineligible.length,
      warnings,
      requiresReview:
        collisionCount > 0 ||
        ineligibleCount > 0 ||
        warnings.accessLosers.length > 0 ||
        warnings.koboImpact.length > 0 ||
        warnings.formatMismatches.length > 0 ||
        warnings.layout !== null,
    };
  }

  private async buildWarnings(
    resolved: ResolvedPlan,
    movingPlans: BookMovePlan[],
    layoutCounts: Map<BookMoveLayoutChange, number>,
  ): Promise<BookMoveWarnings> {
    const { target, sourceLibraryIds } = resolved;

    const bookCountByLibrary = new Map<number, number>();
    for (const plan of movingPlans) {
      bookCountByLibrary.set(plan.sourceLibraryId, (bookCountByLibrary.get(plan.sourceLibraryId) ?? 0) + 1);
    }

    const accessRows = await this.moveRepo.findLibraryAccess([...new Set([...sourceLibraryIds, target.libraryId])]);
    const targetUserIds = new Set(accessRows.filter((row) => row.libraryId === target.libraryId).map((row) => row.userId));

    const losingBookCounts = new Map<number, number>();
    for (const row of accessRows) {
      if (row.libraryId === target.libraryId || targetUserIds.has(row.userId)) continue;
      const affected = bookCountByLibrary.get(row.libraryId) ?? 0;
      if (affected === 0) continue;
      losingBookCounts.set(row.userId, (losingBookCounts.get(row.userId) ?? 0) + affected);
    }

    const userRows = await this.moveRepo.findUsers([...losingBookCounts.keys()]);
    const nonSuperusers = userRows.filter((row) => !row.isSuperuser);
    const deviceCounts = await this.moveRepo.countKoboDevicesByUser(nonSuperusers.map((row) => row.id));

    const accessLosers = nonSuperusers.map((row) => ({
      userId: row.id,
      username: row.username,
      bookCount: losingBookCounts.get(row.id) ?? 0,
    }));

    const koboImpact = accessLosers
      .filter((loser) => (deviceCounts.get(loser.userId) ?? 0) > 0)
      .map((loser) => ({
        userId: loser.userId,
        username: loser.username,
        deviceCount: deviceCounts.get(loser.userId) ?? 0,
        bookCount: loser.bookCount,
      }));

    const allowedFormats = target.allowedFormats ?? [];
    const formatMismatches =
      allowedFormats.length === 0
        ? []
        : movingPlans
            .filter((plan) => !allowedFormats.includes(plan.primaryFormat))
            .slice(0, BOOK_MOVE_DETAIL_LIMIT)
            .map((plan) => ({ bookId: plan.bookId, title: plan.title, format: plan.primaryFormat }));

    const [layoutChange, layoutBookCount] = [...layoutCounts.entries()][0] ?? [null, 0];

    return {
      accessLosers,
      koboImpact,
      layout: layoutChange ? { change: layoutChange, bookCount: layoutBookCount } : null,
      formatMismatches,
      crossDevice: await this.detectCrossDevice(movingPlans, target),
    };
  }

  private async detectCrossDevice(movingPlans: BookMovePlan[], target: MoveTargetLibrary): Promise<boolean> {
    if (movingPlans.length === 0) return false;

    const targetDevice = await stat(target.folderPath)
      .then((info) => info.dev)
      .catch(() => null);
    if (targetDevice === null) return false;

    const sourceRoots = [...new Set(movingPlans.map((plan) => plan.sourceLibraryFolderPath))];
    for (const root of sourceRoots) {
      const device = await stat(root)
        .then((info) => info.dev)
        .catch(() => null);
      if (device !== null && device !== targetDevice) return true;
    }

    return false;
  }

  private async notifyCompletion(userId: number, target: MoveTargetLibrary, movedCount: number, failed: number): Promise<void> {
    await this.notificationService
      .notify({
        type: failed > 0 ? NotificationType.BulkRenameFailed : NotificationType.BulkRenameCompleted,
        title: failed > 0 ? 'Book move completed with errors' : 'Book move completed',
        message: `${movedCount} moved to ${target.libraryName}, ${failed} failed`,
        scope: { kind: 'user', userId },
        meta: { targetLibraryId: target.libraryId, moved: movedCount, failed },
      })
      .catch(() => {});
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
