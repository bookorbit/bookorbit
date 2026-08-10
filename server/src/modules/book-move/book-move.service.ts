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

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookService } from '../book/book.service';
import { NotificationService } from '../notification/notification.service';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { ScanGateway } from '../scanner/scan.gateway';
import { ScannerService } from '../scanner/scanner.service';
import { BookMoveExecutorService } from './book-move-executor.service';
import type { BookMovePlan, BookMovePlanOutcome, PlanCollision } from './book-move-planner.service';
import { BookMovePlannerService } from './book-move-planner.service';
import type { MoveTargetLibrary } from './book-move.repository';
import { BookMoveRepository } from './book-move.repository';
import type { MoveBooksDto, MovePreviewDto } from './dto/move-books.dto';

const MOVE_EVENT = 'book_move.job';
const EDITOR_LEVELS = new Set(['editor', 'owner']);
const MAX_PLAN_ROUNDS = 5;

export interface BookMoveStreamOptions {
  onProgress: (event: BookMoveProgressEvent) => void;
  isCancelled: () => boolean;
}

interface ResolvedPlan {
  target: MoveTargetLibrary;
  outcomes: BookMovePlanOutcome[];
  totalSelected: number;
  sourceLibraryIds: number[];
}

@Injectable()
export class BookMoveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookMoveService.name);
  private readonly busyLibraries = new Set<number>();

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
  ) {}

  /**
   * Job progress is in-memory like every other bulk job, so a crash leaves a row
   * behind. Repair the affected libraries immediately rather than waiting for the
   * watcher's half-hourly reconcile.
   */
  async onApplicationBootstrap(): Promise<void> {
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
      this.scannerService.startScanAsync(libraryId);
    }
  }

  isBusy(libraryId: number): boolean {
    return this.busyLibraries.has(libraryId);
  }

  async preview(dto: MovePreviewDto, user: RequestUser): Promise<BookMovePreviewResult> {
    const resolved = await this.resolvePlan(dto, user);
    return this.buildPreview(resolved);
  }

  async execute(dto: MoveBooksDto, user: RequestUser, options: BookMoveStreamOptions): Promise<BookMoveSummary> {
    const startedAt = Date.now();
    const resolved = await this.resolvePlan(dto, user);
    const { target } = resolved;

    const involvedLibraryIds = [...new Set([target.libraryId, ...resolved.sourceLibraryIds])];
    this.assertLibrariesAvailable(involvedLibraryIds);

    const overrides = new Map((dto.overrides ?? []).map((override) => [override.bookId, override.policy]));
    const work = this.selectWork(resolved.outcomes, dto.collisionPolicy, overrides);

    for (const libraryId of involvedLibraryIds) this.busyLibraries.add(libraryId);

    const jobId = await this.moveRepo.createJob({
      startedBy: user.id,
      targetLibraryId: target.libraryId,
      targetFolderId: target.folderId,
      sourceLibraryIds: resolved.sourceLibraryIds,
      totalBooks: work.length,
    });

    this.logger.log(
      `[${MOVE_EVENT}] [start] jobId=${jobId} userId=${user.id} toLibraryId=${target.libraryId} toFolderId=${target.folderId} ` +
        `sourceLibraryIds=${resolved.sourceLibraryIds.join(',')} bookCount=${work.length} - book move started`,
    );

    const stoppedWatchers = await this.stopWatchers(involvedLibraryIds);

    let succeeded = 0;
    let merged = 0;
    let failed = 0;
    let skipped = 0;
    const movedByLibrary = new Map<number, number[]>();

    try {
      for (const item of work) {
        if (options.isCancelled()) break;

        if (item.skipReason) {
          skipped++;
          options.onProgress({ bookId: item.plan.bookId, status: 'skipped', reason: item.skipReason });
          continue;
        }

        try {
          const result = await this.executor.execute({
            plan: item.plan,
            target,
            mergeDuplicateBookId: item.mergeDuplicateBookId,
          });

          if (result.status === 'success' || result.status === 'merged') {
            if (result.status === 'merged') merged++;
            else succeeded++;

            const list = movedByLibrary.get(item.plan.sourceLibraryId);
            if (list) list.push(item.plan.bookId);
            else movedByLibrary.set(item.plan.sourceLibraryId, [item.plan.bookId]);

            options.onProgress({ bookId: item.plan.bookId, status: result.status });
          } else if (result.status === 'skipped') {
            skipped++;
            options.onProgress({ bookId: item.plan.bookId, status: 'skipped', reason: result.reason });
          } else {
            failed++;
            options.onProgress({ bookId: item.plan.bookId, status: 'failed', reason: result.reason });
          }
        } catch (error) {
          failed++;
          options.onProgress({ bookId: item.plan.bookId, status: 'failed', reason: getErrorMessage(error) });
        }
      }

      const cancelled = options.isCancelled();
      await this.moveRepo.finishJob(jobId, 'completed', { succeeded, merged, failed, skipped });

      this.logger.log(
        `[${MOVE_EVENT}] [end] jobId=${jobId} userId=${user.id} durationMs=${Date.now() - startedAt} succeeded=${succeeded} ` +
          `merged=${merged} failed=${failed} skipped=${skipped} cancelled=${cancelled} - book move completed`,
      );

      this.emitTransfers(movedByLibrary, target.libraryId);
      await this.notifyCompletion(user.id, target, succeeded + merged, failed);

      return { processed: succeeded + merged + failed + skipped, succeeded, merged, failed, skipped, cancelled };
    } catch (error) {
      await this.moveRepo.finishJob(jobId, 'failed', { succeeded, merged, failed, skipped }, getErrorMessage(error));
      this.logger.error(
        `[${MOVE_EVENT}] [fail] jobId=${jobId} userId=${user.id} durationMs=${Date.now() - startedAt} ` +
          `errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(getErrorMessage(error))}" - book move failed`,
      );
      this.emitTransfers(movedByLibrary, target.libraryId);
      throw error;
    } finally {
      for (const libraryId of involvedLibraryIds) this.busyLibraries.delete(libraryId);
      await this.restartWatchers(stoppedWatchers);
    }
  }

  private assertLibrariesAvailable(libraryIds: number[]): void {
    for (const libraryId of libraryIds) {
      if (this.busyLibraries.has(libraryId)) {
        throw new ConflictException(`A move is already running for library ${libraryId}.`);
      }
      if (this.scannerService.isScanRunning(libraryId)) {
        throw new ConflictException(`A scan is running for library ${libraryId}. Wait for it to finish before moving books.`);
      }
    }
  }

  private async stopWatchers(libraryIds: number[]): Promise<number[]> {
    const watched = await this.moveRepo.findWatchedLibraryIds(libraryIds);
    for (const libraryId of watched) {
      await this.fileWatcherService.stopWatcher(libraryId);
    }
    return watched;
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

    return { target, outcomes, totalSelected: bookIds.length, sourceLibraryIds };
  }

  private async assertEditorAccess(user: RequestUser, libraryIds: number[]): Promise<void> {
    if (user.isSuperuser || libraryIds.length === 0) return;

    const access = await this.moveRepo.findLibraryAccess(libraryIds);
    const granted = new Set(access.filter((row) => row.userId === user.id && EDITOR_LEVELS.has(row.accessLevel)).map((row) => row.libraryId));

    const missing = libraryIds.filter((id) => !granted.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(`Editor access is required for library ${missing[0]} to move books`);
    }
  }

  private selectWork(
    outcomes: BookMovePlanOutcome[],
    jobPolicy: BookMoveJobCollisionPolicy,
    overrides: Map<number, BookMoveCollisionPolicy>,
  ): { plan: BookMovePlan; mergeDuplicateBookId: number | null; skipReason?: string }[] {
    const work: { plan: BookMovePlan; mergeDuplicateBookId: number | null; skipReason?: string }[] = [];

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

  private applyCollisionPolicy(
    plan: BookMovePlan,
    collision: PlanCollision,
    policy: BookMoveCollisionPolicy,
  ): { plan: BookMovePlan; mergeDuplicateBookId: number | null; skipReason?: string } | null {
    if (policy === 'skip') return null;

    if (policy === 'merge') {
      // Merging replaces the book already in the target library. That is only
      // meaningful when the two hold identical content; for a name-only clash it
      // would delete an unrelated book, so refuse instead of guessing.
      if (collision.kind !== 'hash_duplicate' || collision.existingBookId == null) {
        return { plan, mergeDuplicateBookId: null, skipReason: 'merge only applies to identical copies' };
      }
      return { plan, mergeDuplicateBookId: collision.existingBookId };
    }

    if (collision.keepBothPlan === plan) {
      return { plan, mergeDuplicateBookId: null, skipReason: 'no free destination name found' };
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
