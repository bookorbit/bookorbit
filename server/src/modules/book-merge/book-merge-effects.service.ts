import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { rm, stat, unlink } from 'fs/promises';
import { dirname, join } from 'path';

import type { ReadStatus } from '@bookorbit/types';

import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { computeContentHash, isInsideRoot, removeEmptyDirs } from '../../common/utils/file-move.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { storageConfig } from '../../config/config';
import {
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  AchievementEventsService,
} from '../achievement/achievement-events.service';
import { BookConsolidationService } from '../book-consolidation/book-consolidation.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { ScannerService } from '../scanner/scanner.service';
import { StoryEditsService } from '../story-edits/story-edits.service';
import { ReadingAttemptEventsService } from '../user-book-status/reading-attempt-events.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { UserStatisticsService } from '../user-statistics/user-statistics.service';
import { reviveCoverSlots, type StoredCoverSlots } from './book-merge.executor';
import type { MergeExecutionPlan } from './book-merge.planner';
import { BookMergeRepository, type MergeJobRow } from './book-merge.repository';

const MERGE_EVENT = 'book_merge';

export interface MergeEffectsInput {
  job: MergeJobRow;
  plan: MergeExecutionPlan;
  mergedSourceIds: number[];
  /** Null when unknown (a job committed before these were stored): the per-user steps are then skipped. */
  affectedUserIds: number[] | null;
  ratingChangedUserIds: number[] | null;
  /** Users whose Kobo entitlement, and with it the source's Kobo reading state, moved to the kept book. */
  koboEntitlementMovedUserIds: number[] | null;
}

/**
 * Everything a committed merge still owes outside its transaction (01-architecture.md 3.4). Each
 * step is idempotent and failures are logged, never thrown: recovery runs this again after a crash.
 */
@Injectable()
export class BookMergeEffectsService {
  private readonly logger = new Logger(BookMergeEffectsService.name);
  private readonly kepubCachePath: string;

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    private readonly repository: BookMergeRepository,
    private readonly consolidation: BookConsolidationService,
    private readonly coverStore: BookCoverStore,
    private readonly scanner: ScannerService,
    private readonly metadataScore: MetadataScoreService,
    private readonly embedder: BookEmbedderService,
    private readonly achievementEvents: AchievementEventsService,
    private readonly readingAttemptEvents: ReadingAttemptEventsService,
    private readonly userBookStatus: UserBookStatusService,
    private readonly storyEdits: StoryEditsService,
    private readonly fileLocks: FileLockService,
    private readonly selfWrites: SelfWriteRegistry,
    private readonly userStatistics: UserStatisticsService,
  ) {
    this.kepubCachePath = join(storage.appDataPath, '.kepub-cache');
  }

  /** Returns how many identical copies were retired. */
  async apply(input: MergeEffectsInput): Promise<number> {
    const { job, plan, mergedSourceIds } = input;
    const targetBookId = plan.targetBookId;
    if (mergedSourceIds.length === 0) return 0;

    const storedSlots = (job.plan as { coverSlots?: StoredCoverSlots }).coverSlots ?? {};
    for (const sourceBookId of mergedSourceIds) {
      await this.attempt(job.id, 'covers', async () => {
        await this.coverStore.adoptSlots(sourceBookId, reviveCoverSlots(storedSlots[String(sourceBookId)]), targetBookId);
        await this.coverStore.removeCoverDirectory(sourceBookId);
      });
      await this.attempt(job.id, 'kepub_cache', () =>
        rm(join(this.kepubCachePath, String(Math.trunc(sourceBookId))), { recursive: true, force: true }),
      );
    }

    const retired = plan.deleteIdenticalCopies ? await this.retireIdenticalCopies(job.id, plan) : 0;

    await this.attempt(job.id, 'rescan', () => Promise.resolve(this.scanner.scanBookDirectoryAsync(plan.destination.folderPath, plan.libraryId)));
    await this.attempt(job.id, 'metadata_score', () => this.metadataScore.calculateAndSaveMany([targetBookId]));
    await this.attempt(job.id, 'story_edits', () => this.storyEdits.resyncBook(targetBookId));
    void this.embedder.embedBook(targetBookId).catch(() => undefined);

    const affectedUserIds = input.affectedUserIds ?? [];
    const readers = [...new Set([...affectedUserIds, ...(input.koboEntitlementMovedUserIds ?? [])])];
    let statuses = new Map<number, string>();
    if (readers.length > 0) {
      await this.attempt(job.id, 'reader_events', async () => {
        statuses = await this.repository.findStatuses(readers, targetBookId);
        for (const userId of affectedUserIds) {
          const status = statuses.get(userId);
          if (status)
            this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, {
              userId,
              bookId: targetBookId,
              newStatus: status,
              previousStatus: null,
            });
          this.readingAttemptEvents.notifyChanged(userId);
        }
        const ratings = await this.repository.findRatings(input.ratingChangedUserIds ?? [], targetBookId);
        for (const userId of input.ratingChangedUserIds ?? []) {
          this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, {
            userId,
            bookIds: [targetBookId],
            rating: ratings.get(userId) ?? null,
          });
        }
      });
    }
    for (const [userId, status] of statuses) await this.projectKoboStatus(job.id, userId, targetBookId, status as ReadStatus);
    // Daily reading stats are kept per library: time read on a book that changed library goes with it.
    for (const userId of plan.dailyStatsUserIds ?? []) {
      await this.attempt(
        job.id,
        'daily_stats',
        async () => {
          const timeZone = (await this.userStatistics.getUserTimeZone(userId)) ?? 'UTC';
          await this.userStatistics.rebuildDailyStatsForUser(userId, timeZone);
        },
        `userId=${userId}`,
      );
    }
    return retired;
  }

  /**
   * The merged status onto the kept book's Kobo reading state, as a status change elsewhere does:
   * the state may be the source's, moved with its entitlement, or the kept book's from before.
   */
  private async projectKoboStatus(jobId: number, userId: number, bookId: number, status: ReadStatus): Promise<void> {
    await this.attempt(jobId, 'kobo_status', () => this.userBookStatus.projectKoboStatus(userId, [bookId], status), `userId=${userId}`);
  }

  /**
   * Opt-in removal of byte-identical copies. Each copy's readers move to the one that stays first
   * (`retireFile`), so nobody's progress on it is lost; then the file goes from disk.
   */
  private async retireIdenticalCopies(jobId: number, plan: MergeExecutionPlan): Promise<number> {
    let retired = 0;
    await this.fileLocks.withLock(bookOperationLockKey(plan.targetBookId), async () => {
      for (const pair of plan.identicalPairs) {
        await this.attempt(jobId, 'retire_copy', async () => {
          const path = await this.repository.findFilePath(pair.loserFileId, plan.targetBookId);
          if (!path) return;
          const survivorPath = await this.repository.findFilePath(pair.survivorFileId, plan.targetBookId);
          // The pair was proved identical at preview time, and the merge's own locks are gone since.
          const changed = survivorPath ? await this.copyChanged(path, survivorPath) : 'survivor_missing';
          if (changed) {
            this.logger.warn(
              `[${MERGE_EVENT}] [end] jobId=${jobId} effect=retire_copy loserFileId=${pair.loserFileId} survivorFileId=${pair.survivorFileId} ` +
                `outcome=skipped reason=${changed} - identical copy kept`,
            );
            return;
          }
          await this.repository.transaction((tx) =>
            this.consolidation.retireFile(tx, { bookId: plan.targetBookId, loserFileId: pair.loserFileId, survivorFileId: pair.survivorFileId }),
          );
          const root = plan.destination.libraryFolderPath;
          const suppressed = [path, dirname(path)];
          this.selfWrites.begin(suppressed);
          try {
            await unlink(path).catch(() => undefined);
            if (isInsideRoot(root, dirname(path))) await removeEmptyDirs(dirname(path), root);
          } finally {
            this.selfWrites.end(suppressed);
          }
          retired += 1;
        });
      }
    });
    return retired;
  }

  /** Why the copy may no longer go: it or its twin is gone, or their bytes differ now. Null when still identical. */
  private async copyChanged(path: string, survivorPath: string): Promise<string | null> {
    const [copy, survivor] = await Promise.all([stat(path).catch(() => null), stat(survivorPath).catch(() => null)]);
    if (!copy?.isFile()) return 'copy_missing';
    if (!survivor?.isFile()) return 'survivor_missing';
    if (copy.size !== survivor.size) return 'size_changed';
    const copyHash = await computeContentHash(path);
    const survivorHash = await computeContentHash(survivorPath);
    return copyHash === survivorHash ? null : 'content_changed';
  }

  private async attempt(jobId: number, effect: string, work: () => Promise<unknown>, context = ''): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        `[${MERGE_EVENT}] [fail] jobId=${jobId} effect=${effect}${context ? ` ${context}` : ''} errorClass=${error instanceof Error ? error.name : 'Error'} ` +
          `error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - post-merge step failed`,
      );
    }
  }
}
