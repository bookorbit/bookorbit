import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { basename, dirname, extname, join, resolve } from 'path';
import { access as fsAccess, readFile, stat, unlink } from 'fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  AudiobookChapter,
  BookDockAutoFinalizeMetadataMode,
  BookDockDiscardDuplicatesResult,
  BookDockFinalizeFileResult,
  BookDockFinalizePreviewItem,
  BookDockFinalizePreviewResult,
  BookDockFinalizePreviewStatus,
  BookDockFinalizeResult,
  BookDockMetadata,
  ComicMetadataFields,
  MetadataSeriesMembership,
} from '@bookorbit/types';
import { MetadataProviderKey, NotificationType, resolveDownloadFilename, resolveUploadPath } from '@bookorbit/types';
import { BookReadService } from '../book/book-read.service';
import { NotificationService } from '../notification/notification.service';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { formatSeriesIndex } from '../../common/utils/series-index-format.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, libraries, libraryFolders } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { UploadProcessorService } from '../upload/upload-processor.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED } from './book-dock-events.service';
import { BookDockGateway } from './book-dock.gateway';
import { normalizeBookDockMetadata } from './book-dock-metadata.utils';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWorkQueue } from './book-dock-work-queue';
import type { BookDockFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type LibraryRow = typeof libraries.$inferSelect;
type LibraryFolderRow = typeof libraryFolders.$inferSelect;

type FinalizeOverrideEntry = {
  libraryId?: number;
  folderId?: number;
  targetFileName?: string;
};

const BATCH_SIZE = 100;
const PREVIEW_ITEM_LIMIT = 200;
const AUTO_FINALIZE_QUEUE_CONCURRENCY = 1;
const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = 2200;
const PUBLISHED_YEAR_RANGE_CONSTRAINT = 'book_metadata_published_year_range_chk';
const INVALID_PUBLISHED_YEAR_MESSAGE = `Invalid metadata: published year must be between ${MIN_PUBLISHED_YEAR} and ${MAX_PUBLISHED_YEAR}.`;
const INVALID_METADATA_MESSAGE = 'Invalid metadata values for this file. Review metadata fields and try again.';
const METADATA_PROVIDER_KEYS = new Set<MetadataProviderKey>(Object.values(MetadataProviderKey));

type NormalizedFinalizeMetadata = {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: string[];
  genres: string[];
  coverUrl: string | null;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  hardcoverEditionId: string | null;
  openLibraryId: string | null;
  itunesId: string | null;
  audibleId: string | null;
  librofmId: string | null;
  koboId: string | null;
  comicvineId: string | null;
  ranobedbId: string | null;
  lubimyczytacId: string | null;
  aladinId: string | null;
  seriesMemberships: MetadataSeriesMembership[] | undefined;
  communityRatings: Array<{ provider: MetadataProviderKey; rating: number; ratingCount: number | null }> | undefined;
  comicMetadata: ComicMetadataFields | undefined;
};

type FinalizeCandidateAnalysis = {
  fileId: number;
  fileName: string;
  row: BookDockFileRow;
  status: BookDockFinalizePreviewStatus;
  message?: string;
  existingBookId?: number;
  newName?: string;
  library?: LibraryRow;
  folder?: LibraryFolderRow;
  format?: string;
  destPath?: string;
};

@Injectable()
export class BookDockFinalizeService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookDockFinalizeService.name);
  private readonly autoFinalizeQueue: BookDockWorkQueue;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BookDockRepository,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataService: MetadataService,
    private readonly metadataScoreService: MetadataScoreService,
    private readonly bookReadService: BookReadService,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly processor: UploadProcessorService,
    private readonly events: BookDockEventsService,
    private readonly gateway: BookDockGateway,
    private readonly notificationService: NotificationService,
    private readonly processingState: BookDockProcessingStateService,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
  ) {
    this.autoFinalizeQueue = new BookDockWorkQueue(
      AUTO_FINALIZE_QUEUE_CONCURRENCY,
      (fileId) => this.triggerAutoFinalize(fileId),
      (fileId, error) => this.logAutoFinalizeQueueFailure(fileId, error),
    );
  }

  onModuleInit() {
    this.events.on(BOOK_DOCK_FILE_INGESTED, (fileId: number) => {
      this.enqueueAutoFinalize(fileId);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.autoFinalizeQueue.pause();
    }
  }

  onModuleDestroy(): void {
    this.autoFinalizeQueue.stop();
  }

  async finalize(
    userId: number,
    isSuperuser: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
  ): Promise<BookDockFinalizeResult> {
    const ids = selectAll ? [] : dedupeIds(fileIds ?? []);
    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));

    const results: BookDockFinalizeFileResult[] = [];
    let succeeded = 0;
    let failed = 0;

    if (selectAll) {
      let afterId: number | undefined;
      while (true) {
        const rows = await this.repo.findSelectionBatch({
          limit: BATCH_SIZE,
          afterId,
          excludedIds,
          status,
          search,
          userId,
          isSuperuser,
        });
        if (rows.length === 0) break;

        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
        for (const analysis of prepared.analyses) {
          const result = await this.finalizePreparedCandidate(analysis, prepared.existingDestinations);
          results.push(result);
          if (result.success) succeeded++;
          else failed++;
        }

        afterId = rows[rows.length - 1]?.id;
      }
    } else {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const rows = await this.repo.findByIds(batch, userId, isSuperuser);
        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
        const analysisById = new Map(prepared.analyses.map((analysis) => [analysis.fileId, analysis]));

        for (const fileId of batch) {
          const analysis = analysisById.get(fileId);
          if (!analysis) {
            failed++;
            results.push({
              fileId,
              fileName: `book-dock-file-${fileId}`,
              success: false,
              message: 'Book Dock file not found',
            });
            continue;
          }

          const result = await this.finalizePreparedCandidate(analysis, prepared.existingDestinations);
          results.push(result);
          if (result.success) succeeded++;
          else failed++;
        }
      }
    }

    await this.emitSummary();

    this.notificationService
      .notify({
        type: NotificationType.BookDockFinalized,
        title: 'Book Dock finalization completed',
        message: `${succeeded} succeeded, ${failed} failed`,
        scope: { kind: 'user', userId },
        meta: { total: results.length, succeeded, failed },
      })
      .catch(() => {});

    return { total: results.length, succeeded, failed, results };
  }

  private async finalizeFile(
    row: BookDockFileRow,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, FinalizeOverrideEntry>,
    userId: number,
    isSuperuser: boolean,
  ): Promise<BookDockFinalizeFileResult> {
    const prepared = await this.prepareFinalizeBatch([row], defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
    const analysis = prepared.analyses[0];
    if (!analysis) {
      return { fileId: row.id, fileName: row.fileName, success: false, message: 'Finalization target could not be resolved' };
    }
    return this.finalizePreparedCandidate(analysis, prepared.existingDestinations);
  }

  private async finalizePreparedCandidate(
    preparedAnalysis: FinalizeCandidateAnalysis,
    existingDestinations: Map<string, number>,
  ): Promise<BookDockFinalizeFileResult> {
    const row = preparedAnalysis.row;
    try {
      const analysis = await this.classifyDestination(preparedAnalysis, existingDestinations);
      if (analysis.status !== 'ready') return this.analysisToFileResult(analysis);

      const { destPath, folder, library, format } = analysis;
      if (!destPath || !folder || !library || !format) {
        return { fileId: row.id, fileName: row.fileName, success: false, message: 'Finalization target could not be resolved' };
      }

      await this.storage.moveToPath(row.absolutePath, destPath);

      let bookId: number;
      try {
        const { size } = await stat(destPath);
        const bookFolderPath = library.organizationMode === 'book_per_file' ? destPath : dirname(destPath);
        ({ bookId } = await this.processor.createBookRecord(
          library.id,
          folder.id,
          bookFolderPath,
          destPath,
          destPath.substring(folder.path.length + 1),
          format,
          size,
        ));
        await this.applyMetadata(bookId, row);
      } catch (err) {
        await this.storage.moveToPath(destPath, row.absolutePath).catch(() => {});
        throw err;
      }

      await this.cleanupBookDockRecord(row);
      existingDestinations.set(this.destinationKey(library.id, destPath), bookId);

      const newName = destPath.substring(folder.path.length + 1);
      return { fileId: row.id, fileName: row.fileName, newName, success: true, bookId };
    } catch (err) {
      const message = resolveFinalizeErrorMessage(err);
      this.logger.warn(`Finalize failed for Book Dock file ${row.id}: ${message}`);
      return { fileId: row.id, fileName: row.fileName, success: false, message };
    }
  }

  async previewFinalize(
    userId: number,
    isSuperuser: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
  ): Promise<BookDockFinalizePreviewResult> {
    const summary = createFinalizePreviewSummary();
    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));

    await this.processFinalizeSelection(userId, isSuperuser, fileIds, selectAll, excludedIds, status, search, async (rows, missingIds) => {
      const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
      for (const candidate of prepared.analyses) {
        const analysis = await this.classifyDestination(candidate, prepared.existingDestinations);
        addFinalizePreviewAnalysis(summary, analysis);
      }
      for (const fileId of missingIds) {
        addFinalizePreviewItem(summary, {
          fileId,
          fileName: `book-dock-file-${fileId}`,
          status: 'error',
          message: 'Book Dock file not found',
        });
      }
    });

    return summary;
  }

  async discardDuplicateCandidates(
    userId: number,
    isSuperuser: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
  ): Promise<BookDockDiscardDuplicatesResult> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.discard_duplicates] [start] userId=${userId} selectAll=${selectAll === true} - duplicate discard started`);

    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));
    let total = 0;
    let discarded = 0;
    const discardedFileIds: number[] = [];

    try {
      await this.processFinalizeSelection(userId, isSuperuser, fileIds, selectAll, excludedIds, status, search, async (rows, missingIds) => {
        total += rows.length + missingIds.length;
        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser);
        const duplicateRows: BookDockFileRow[] = [];

        for (const candidate of prepared.analyses) {
          const analysis = await this.classifyDestination(candidate, prepared.existingDestinations);
          if (analysis.status === 'duplicate') duplicateRows.push(candidate.row);
        }

        if (duplicateRows.length === 0) return;

        for (const row of duplicateRows) {
          await this.cleanupDiscardedBookDockFile(row);
          discardedFileIds.push(row.id);
        }
        await this.repo.deleteByIds(duplicateRows.map((row) => row.id));
        discarded += duplicateRows.length;
      });

      await this.emitSummary();
      const result = { total, discarded, skipped: total - discarded, discardedFileIds: selectAll ? [] : discardedFileIds };
      this.logger.log(
        `[book_dock.discard_duplicates] [end] userId=${userId} durationMs=${Date.now() - startedAt} total=${total} discarded=${discarded} skipped=${result.skipped} - duplicate discard completed`,
      );
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[book_dock.discard_duplicates] [fail] userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - duplicate discard failed`,
      );
      throw error;
    }
  }

  private async resolveFinalizeCandidate(
    row: BookDockFileRow,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, FinalizeOverrideEntry>,
    userId: number,
    isSuperuser: boolean,
  ): Promise<FinalizeCandidateAnalysis> {
    try {
      const override = overrideMap.get(row.id);
      const libraryId = override?.libraryId ?? row.targetLibraryId ?? defaultLibraryId ?? null;
      const folderId = override?.folderId ?? row.targetFolderId ?? defaultFolderId ?? null;

      if (libraryId === null || folderId === null) {
        return {
          fileId: row.id,
          fileName: row.fileName,
          row,
          status: 'missing_destination',
          message: 'Destination is not set for this file',
        };
      }

      const library = await this.findLibraryOrFail(libraryId);
      await this.libraryService.verifyUserAccess(userId, libraryId, isSuperuser);

      const folder = await this.findFolderOrFail(folderId, libraryId);
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      this.validator.validateFormat(row.fileName, library.allowedFormats);

      const patternDestPath = await this.resolveDestination(library, folder.path, row, format);
      let destPath = patternDestPath;
      if (override?.targetFileName) {
        const stem = format ? override.targetFileName.replace(new RegExp(`\\.${format}$`, 'i'), '') : override.targetFileName;
        const safeFileName = this.validator.sanitizeFilename(format ? `${stem}.${format}` : stem);
        const candidate = join(dirname(patternDestPath), safeFileName);
        if (resolve(dirname(candidate)) !== resolve(dirname(patternDestPath))) {
          return { fileId: row.id, fileName: row.fileName, row, status: 'invalid_target', message: 'Invalid file name' };
        }
        destPath = candidate;
      }

      const newName = destPath.substring(folder.path.length + 1);

      return { fileId: row.id, fileName: row.fileName, row, status: 'ready', newName, library, folder, format, destPath };
    } catch (error) {
      return {
        fileId: row.id,
        fileName: row.fileName,
        row,
        status: classifyFinalizePreviewError(error),
        message: resolveFinalizeErrorMessage(error),
      };
    }
  }

  private async prepareFinalizeBatch(
    rows: BookDockFileRow[],
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, FinalizeOverrideEntry>,
    userId: number,
    isSuperuser: boolean,
  ): Promise<{ analyses: FinalizeCandidateAnalysis[]; existingDestinations: Map<string, number> }> {
    const analyses: FinalizeCandidateAnalysis[] = [];
    for (const row of rows) {
      analyses.push(await this.resolveFinalizeCandidate(row, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser));
    }

    const destinationPaths = analyses.filter((analysis) => analysis.status === 'ready' && analysis.destPath).map((analysis) => analysis.destPath!);
    const existingRows = await this.repo.findExistingBooksByAbsolutePaths(destinationPaths);
    const existingDestinations = new Map(
      existingRows.map((existing) => [this.destinationKey(existing.libraryId, existing.absolutePath), existing.bookId]),
    );

    return { analyses, existingDestinations };
  }

  private async classifyDestination(
    analysis: FinalizeCandidateAnalysis,
    existingDestinations: Map<string, number>,
  ): Promise<FinalizeCandidateAnalysis> {
    if (analysis.status !== 'ready' || !analysis.destPath || !analysis.library) return analysis;

    try {
      await fsAccess(analysis.destPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return analysis;
      return {
        ...analysis,
        status: 'error',
        message: resolveFinalizeErrorMessage(error),
      };
    }

    const existingBookId = existingDestinations.get(this.destinationKey(analysis.library.id, analysis.destPath));
    if (existingBookId !== undefined) {
      return {
        ...analysis,
        status: 'duplicate',
        existingBookId,
        message: 'A file with this name already exists at the target location',
      };
    }

    return {
      ...analysis,
      status: 'destination_conflict',
      message: 'A file with this name already exists at the target location',
    };
  }

  private destinationKey(libraryId: number, absolutePath: string): string {
    return `${libraryId}\u0000${absolutePath}`;
  }

  private analysisToFileResult(analysis: FinalizeCandidateAnalysis): BookDockFinalizeFileResult {
    if (analysis.status === 'duplicate') {
      return {
        fileId: analysis.fileId,
        fileName: analysis.fileName,
        newName: analysis.newName,
        success: false,
        isDuplicate: true,
        existingBookId: analysis.existingBookId,
        message: analysis.message,
      };
    }

    return {
      fileId: analysis.fileId,
      fileName: analysis.fileName,
      newName: analysis.newName,
      success: false,
      message: analysis.message,
    };
  }

  private async processFinalizeSelection(
    userId: number,
    isSuperuser: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    status: string | undefined,
    search: string | undefined,
    processBatch: (rows: BookDockFileRow[], missingIds: number[]) => Promise<void>,
  ): Promise<void> {
    if (selectAll) {
      let afterId: number | undefined;
      while (true) {
        const rows = await this.repo.findSelectionBatch({
          limit: BATCH_SIZE,
          afterId,
          excludedIds,
          status,
          search,
          userId,
          isSuperuser,
        });
        if (rows.length === 0) break;

        await processBatch(rows, []);
        afterId = rows[rows.length - 1]?.id;
      }
      return;
    }

    const ids = dedupeIds(fileIds ?? []);
    for (let index = 0; index < ids.length; index += BATCH_SIZE) {
      const batch = ids.slice(index, index + BATCH_SIZE);
      const rows = await this.repo.findByIds(batch, userId, isSuperuser);
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const missingIds = batch.filter((id) => !rowById.has(id));
      await processBatch(rows, missingIds);
    }
  }

  async triggerAutoFinalize(fileId: number): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.autoFinalizeQueue.pause();
      return;
    }

    const settings = await this.appSettings.getAutoFinalizeSettings();
    if (!settings.enabled || settings.libraryId === null || settings.folderId === null) return;

    const row = await this.repo.findById(fileId);
    if (!row) return;
    if (!shouldAutoFinalize(row, settings.metadataMode, settings.threshold)) return;

    const autoFinalizeMetadata = resolveAutoFinalizeMetadata(settings.metadataMode, row.embeddedMetadata, row.fetchedMetadata, row.selectedMetadata);
    const rowForFinalize = autoFinalizeMetadata
      ? {
          ...row,
          selectedMetadata: autoFinalizeMetadata,
        }
      : row;

    const result = await this.finalizeFile(rowForFinalize, settings.libraryId, settings.folderId, new Map(), 0, true);
    if (result.success) {
      this.logger.log(`Auto-finalized Book Dock file ${fileId} -> book ${result.bookId} (confidence ${row.confidence}%)`);
      await this.emitSummary();

      this.notificationService
        .notify({
          type: NotificationType.BookDockFinalized,
          title: 'Book auto-finalized',
          message: `"${row.fileName}" was added to your library`,
          scope: row.uploadedBy ? { kind: 'user', userId: row.uploadedBy } : { kind: 'all' },
          meta: { fileId, bookId: result.bookId },
        })
        .catch(() => {});
    } else {
      this.logger.warn(`Auto-finalize skipped for Book Dock file ${fileId}: ${result.message}`);
    }
  }

  private enqueueAutoFinalize(fileId: number): void {
    if (this.processingState.getCachedPaused()) this.autoFinalizeQueue.pause();
    this.autoFinalizeQueue.enqueue(fileId);
  }

  pauseProcessing(): void {
    this.autoFinalizeQueue.pause();
  }

  async resumeProcessing(): Promise<void> {
    if (await this.processingState.isPaused()) return;
    this.autoFinalizeQueue.resume();
  }

  async requeueAutoFinalizeCandidates(): Promise<number> {
    if (await this.processingState.isPaused()) return 0;

    const settings = await this.appSettings.getAutoFinalizeSettings();
    if (!settings.enabled || settings.libraryId === null || settings.folderId === null) return 0;

    let queued = 0;
    let afterId: number | undefined;
    while (!(await this.processingState.isPaused())) {
      const rows = await this.repo.findSelectionBatch({
        limit: BATCH_SIZE,
        afterId,
        status: 'ready',
        userId: 0,
        isSuperuser: true,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (shouldAutoFinalize(row, settings.metadataMode, settings.threshold) && this.autoFinalizeQueue.enqueue(row.id)) {
          queued++;
        }
      }
      afterId = rows[rows.length - 1]?.id;
    }

    return queued;
  }

  private logAutoFinalizeQueueFailure(fileId: number, err: unknown): void {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(
      `[book_dock.auto_finalize_queue] [fail] fileId=${fileId} errorClass=${errorClass} error="${errorMessage}" - auto-finalize queue job failed`,
    );
  }

  async previewNames(
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    userId: number | undefined,
    isSuperuser: boolean | undefined,
    status?: string,
    search?: string,
  ): Promise<{ fileId: number; fileName: string; newName: string }[]> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search, userId, isSuperuser) : (fileIds ?? []);
    if (!ids.length) return [];

    const rows = await this.repo.findByIds(ids, userId, isSuperuser);
    const appPatternFile = await this.appSettings.getUploadPattern();
    const appPatternFolder = await this.appSettings.getUploadPatternBookPerFolder();
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const libraryIds = [...new Set(rows.map((row) => row.targetLibraryId ?? defaultLibraryId).filter((id): id is number => id != null))];
    const libraryMap = libraryIds.length
      ? new Map((await this.db.select().from(libraries).where(inArray(libraries.id, libraryIds))).map((lib) => [lib.id, lib]))
      : new Map<number, typeof libraries.$inferSelect>();

    return rows.map((row) => {
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};
      const effectiveLibraryId = row.targetLibraryId ?? defaultLibraryId ?? null;
      const lib = effectiveLibraryId !== null ? libraryMap.get(effectiveLibraryId) : undefined;
      let newName = lib?.organizationMode === 'book_per_folder' ? join(basename(row.fileName, extname(row.fileName)), row.fileName) : row.fileName;
      const libraryPattern = lib?.fileNamingPattern ?? null;
      const appPattern = lib?.organizationMode === 'book_per_folder' ? appPatternFolder : appPatternFile;
      const pattern = libraryPattern ?? appPattern;

      if (pattern) {
        const tokens = this.buildPatternTokens(meta, row.fileName, format);
        const resolved =
          lib?.organizationMode === 'book_per_file'
            ? resolveDownloadFilename(pattern, tokens, format, { sanitizeForCrossPlatform })
            : resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
        if (resolved) newName = resolved;
      }

      return { fileId: row.id, fileName: row.fileName, newName };
    });
  }

  private async resolveDestination(
    library: { fileNamingPattern?: string | null; organizationMode?: string | null },
    folderPath: string,
    row: BookDockFileRow,
    format: string,
  ): Promise<string> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};

    if (pattern) {
      const tokens = this.buildPatternTokens(meta, row.fileName, format);
      const resolved =
        library.organizationMode === 'book_per_file'
          ? resolveDownloadFilename(pattern, tokens, format, { sanitizeForCrossPlatform })
          : resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
      if (resolved) return join(folderPath, resolved);
    }

    if (library.organizationMode === 'book_per_file') return join(folderPath, row.fileName);

    const stem = basename(row.fileName, extname(row.fileName));
    return join(folderPath, stem, row.fileName);
  }

  private buildPatternTokens(meta: BookDockMetadata, fileName: string, format: string): Record<string, string> {
    const stem = basename(fileName, extname(fileName));
    const tokens: Record<string, string> = { originalFilename: stem, extension: format };

    if (meta.title) tokens['title'] = meta.title;
    if (meta.subtitle) tokens['subtitle'] = meta.subtitle;
    if (meta.publisher) tokens['publisher'] = meta.publisher;
    if (meta.language) tokens['language'] = meta.language;
    if (meta.isbn13) tokens['isbn'] = meta.isbn13;
    if (meta.publishedYear) tokens['year'] = String(meta.publishedYear);
    if (meta.seriesName) tokens['series'] = meta.seriesName;
    const seriesIndex = formatSeriesIndex(meta.seriesIndex ?? null);
    if (seriesIndex) tokens['seriesIndex'] = seriesIndex;
    if (meta.authors && meta.authors.length > 0) {
      tokens['authors'] = meta.authors.join(', ');
    }

    return tokens;
  }

  private async applyMetadata(bookId: number, row: BookDockFileRow): Promise<void> {
    const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata);
    const audio = resolveAudioFinalizeFields(row.embeddedMetadata, row.selectedMetadata);
    let selectedCoverApplied = false;

    const selectedCoverUrl = meta.coverUrl;
    if (selectedCoverUrl) {
      selectedCoverApplied = await this.metadataService.downloadAndSaveCover(selectedCoverUrl, bookId);
    }

    if (!selectedCoverApplied && row.coverPath) {
      try {
        const bytes = await readFile(row.coverPath);
        await this.metadataService.saveExtractedCoverBytes(bookId, bytes);
      } catch (err) {
        this.logger.warn(`Failed to copy Book Dock cover to book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const scalarFields = {
      title: meta.title ?? null,
      subtitle: meta.subtitle ?? null,
      description: meta.description ?? null,
      isbn10: meta.isbn10 ?? null,
      isbn13: meta.isbn13 ?? null,
      publisher: meta.publisher ?? null,
      publishedDate: meta.publishedDate ?? null,
      publishedYear: meta.publishedYear ?? null,
      language: meta.language ?? null,
      seriesName: meta.seriesName ?? null,
      seriesIndex: meta.seriesIndex ?? null,
      pageCount: meta.pageCount ?? null,
      googleBooksId: meta.googleBooksId,
      goodreadsId: meta.goodreadsId,
      amazonId: meta.amazonId,
      hardcoverId: meta.hardcoverId,
      hardcoverEditionId: meta.hardcoverEditionId,
      openLibraryId: meta.openLibraryId,
      itunesId: meta.itunesId,
      audibleId: meta.audibleId,
      librofmId: meta.librofmId,
      koboId: meta.koboId,
      comicvineId: meta.comicvineId,
      ranobedbId: meta.ranobedbId,
      lubimyczytacId: meta.lubimyczytacId,
      aladinId: meta.aladinId,
      updatedAt: new Date(),
    };
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(scalarFields)) ?? scalarFields;

    await this.db
      .update(bookMetadata)
      .set({ ...patch, ...buildAudioMetadataPatch(audio) })
      .where(eq(bookMetadata.bookId, bookId));
    if (meta.seriesMemberships !== undefined) {
      await this.seriesMemberships?.replaceForBook(bookId, meta.seriesMemberships);
    } else {
      await this.seriesMemberships?.syncPrimaryFromMetadata(bookId);
    }

    if (meta.communityRatings !== undefined) {
      await this.bookReadService.replaceCommunityRatings(bookId, meta.communityRatings);
    }

    if (meta.comicMetadata) {
      await this.metadataService.upsertComicMetadata(bookId, meta.comicMetadata);
    }

    if (meta.authors.length > 0) {
      await this.metadataService.replaceAuthors(
        bookId,
        meta.authors.map((name) => ({ name, sortName: null })),
      );
    }

    if (meta.genres.length > 0) {
      await this.metadataService.replaceGenres(bookId, meta.genres);
    }

    if (audio.narrators.length > 0) {
      await this.metadataService.replaceNarrators(
        bookId,
        audio.narrators.map((name) => ({ name, sortName: null })),
      );
    }

    await this.metadataScoreService.calculateAndSave(bookId);
  }

  private async cleanupBookDockRecord(row: BookDockFileRow): Promise<void> {
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
    await this.repo.deleteById(row.id);
  }

  private async cleanupDiscardedBookDockFile(row: BookDockFileRow): Promise<void> {
    await safeUnlink(row.absolutePath);
    if (row.coverPath) {
      await safeUnlink(row.coverPath);
      const thumbPath = row.coverPath.replace(/\.\w+$/, '_thumb.jpg');
      await safeUnlink(thumbPath);
    }
  }

  private async findLibraryOrFail(libraryId: number) {
    const [library] = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!library) throw new NotFoundException('Library not found');
    return library;
  }

  private async findFolderOrFail(folderId: number, libraryId: number) {
    const [folder] = await this.db.select().from(libraryFolders).where(eq(libraryFolders.id, folderId)).limit(1);
    if (!folder || folder.libraryId !== libraryId) throw new BadRequestException('Folder does not belong to this library');
    return folder;
  }

  private async emitSummary(): Promise<void> {
    const summary = await this.repo.countsByStatus();
    const paused = await this.processingState.isPaused();
    this.gateway.emitSummary({ ...summary, paused });
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}

function createFinalizePreviewSummary(): BookDockFinalizePreviewResult {
  return {
    total: 0,
    ready: 0,
    duplicates: 0,
    destinationConflicts: 0,
    missingDestination: 0,
    blocked: 0,
    truncated: false,
    itemLimit: PREVIEW_ITEM_LIMIT,
    items: [],
  };
}

function addFinalizePreviewAnalysis(summary: BookDockFinalizePreviewResult, analysis: FinalizeCandidateAnalysis): void {
  addFinalizePreviewItem(summary, {
    fileId: analysis.fileId,
    fileName: analysis.fileName,
    newName: analysis.newName,
    status: analysis.status,
    existingBookId: analysis.existingBookId,
    message: analysis.message,
  });
}

function addFinalizePreviewItem(summary: BookDockFinalizePreviewResult, item: BookDockFinalizePreviewItem): void {
  summary.total++;
  if (item.status === 'ready') summary.ready++;
  else if (item.status === 'duplicate') summary.duplicates++;
  else if (item.status === 'destination_conflict') summary.destinationConflicts++;
  else if (item.status === 'missing_destination') summary.missingDestination++;
  else summary.blocked++;

  if (summary.items.length < PREVIEW_ITEM_LIMIT) {
    summary.items.push(item);
  } else {
    summary.truncated = true;
  }
}

function classifyFinalizePreviewError(error: unknown): BookDockFinalizePreviewStatus {
  if (error instanceof ForbiddenException) return 'access_denied';
  if (error instanceof NotFoundException) return 'invalid_target';
  if (error instanceof BadRequestException) {
    const message = error.message.toLowerCase();
    if (message.includes('file type') || message.includes('does not allow')) return 'invalid_format';
    return 'invalid_target';
  }
  return 'error';
}

function normalizeText(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
}

function normalizeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.trim(), 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function normalizePublishedYear(value: unknown): number | null {
  const parsed = normalizeInteger(value);
  if (parsed === null) return null;
  if (parsed < MIN_PUBLISHED_YEAR || parsed > MAX_PUBLISHED_YEAR) return null;
  return parsed;
}

function normalizeReal(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.trim()) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeIsbn(value: unknown, len: 10 | 13): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  if (!compact) return null;
  if (len === 10) {
    return /^[0-9]{9}[0-9X]$/.test(compact) ? compact : null;
  }
  return /^[0-9]{13}$/.test(compact) ? compact : null;
}

function normalizeLanguage(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const primary = raw.split(/[;,/|]/)[0]?.trim() ?? '';
  if (primary.length > 0 && primary.length <= 10) return primary;
  const firstWord = primary.split(/\s+/)[0]?.trim() ?? '';
  if (firstWord.length > 0 && firstWord.length <= 10) return firstWord;
  return raw.length <= 10 ? raw : null;
}

function normalizeStringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    normalized.push(trimmed.slice(0, maxLength));
  }
  return normalized;
}

function normalizeFinalizeMetadata(meta: BookDockMetadata | null | undefined): NormalizedFinalizeMetadata {
  const normalizedMeta = normalizeBookDockMetadata(meta);
  const publishedDate = normalizePublishedDate(normalizedMeta?.publishedDate) ?? null;
  return {
    title: normalizeText(normalizedMeta?.title, 1000),
    subtitle: normalizeText(normalizedMeta?.subtitle, 1000),
    description: normalizeText(normalizedMeta?.description),
    isbn10: normalizeIsbn(normalizedMeta?.isbn10, 10),
    isbn13: normalizeIsbn(normalizedMeta?.isbn13, 13),
    publisher: normalizeText(normalizedMeta?.publisher, 500),
    publishedDate,
    publishedYear: publishedDate ? publishedYearFromDateKey(publishedDate) : normalizePublishedYear(normalizedMeta?.publishedYear),
    language: normalizeLanguage(normalizedMeta?.language),
    pageCount: normalizeInteger(normalizedMeta?.pageCount),
    seriesName: normalizeText(normalizedMeta?.seriesName, 500),
    seriesIndex: normalizeReal(normalizedMeta?.seriesIndex),
    authors: normalizeStringArray(normalizedMeta?.authors, 500),
    genres: normalizeStringArray(normalizedMeta?.genres, 200),
    coverUrl: normalizeText(normalizedMeta?.coverUrl),
    googleBooksId: normalizeText(normalizedMeta?.googleBooksId, 50),
    goodreadsId: normalizeText(normalizedMeta?.goodreadsId, 50),
    amazonId: normalizeText(normalizedMeta?.amazonId, 20),
    hardcoverId: normalizeText(normalizedMeta?.hardcoverId, 255),
    hardcoverEditionId: normalizeText(normalizedMeta?.hardcoverEditionId, 50),
    openLibraryId: normalizeText(normalizedMeta?.openLibraryId, 50),
    itunesId: normalizeText(normalizedMeta?.itunesId, 50),
    audibleId: normalizeText(normalizedMeta?.audibleId, 20),
    librofmId: normalizeText(normalizedMeta?.librofmId, 50),
    koboId: normalizeText(normalizedMeta?.koboId, 255),
    comicvineId: normalizeText(normalizedMeta?.comicvineId, 50),
    ranobedbId: normalizeText(normalizedMeta?.ranobedbId, 50),
    lubimyczytacId: normalizeText(normalizedMeta?.lubimyczytacId, 512),
    aladinId: normalizeText(normalizedMeta?.aladinId, 20),
    seriesMemberships: normalizeSeriesMemberships(normalizedMeta?.seriesMemberships),
    communityRatings: normalizeCommunityRatings(normalizedMeta?.communityRatings),
    comicMetadata: normalizeComicMetadata(normalizedMeta?.comicMetadata),
  };
}

function normalizeSeriesMemberships(value: BookDockMetadata['seriesMemberships']): MetadataSeriesMembership[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  const memberships: MetadataSeriesMembership[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const seriesName = normalizeText(item?.seriesName, 500);
    if (!seriesName) continue;
    const key = seriesName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    memberships.push({ seriesName, seriesIndex: normalizeReal(item.seriesIndex) });
  }
  return memberships;
}

function normalizeCommunityRatings(
  value: BookDockMetadata['communityRatings'],
): Array<{ provider: MetadataProviderKey; rating: number; ratingCount: number | null }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  const ratings = new Map<MetadataProviderKey, { provider: MetadataProviderKey; rating: number; ratingCount: number | null }>();
  for (const item of value) {
    if (!item || !METADATA_PROVIDER_KEYS.has(item.provider)) continue;
    if (!Number.isFinite(item.rating) || item.rating < 0 || item.rating > 5) continue;
    const ratingCount = Number.isInteger(item.ratingCount) && item.ratingCount! >= 0 ? item.ratingCount! : null;
    ratings.set(item.provider, { provider: item.provider, rating: item.rating, ratingCount });
  }
  return [...ratings.values()];
}

function normalizeComicMetadata(value: BookDockMetadata['comicMetadata']): ComicMetadataFields | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const comic: ComicMetadataFields = {};
  const issueNumber = normalizeText(value.issueNumber, 50);
  const volumeName = normalizeText(value.volumeName, 500);
  if (issueNumber !== null) comic.issueNumber = issueNumber;
  if (volumeName !== null) comic.volumeName = volumeName;

  const arrayFields = ['pencillers', 'inkers', 'colorists', 'letterers', 'coverArtists', 'characters', 'teams', 'locations', 'storyArcs'] as const;
  for (const field of arrayFields) {
    const normalized = normalizeStringArray(value[field], 500);
    if (normalized.length > 0) comic[field] = normalized;
  }

  return Object.keys(comic).length > 0 ? comic : undefined;
}

type AudioFinalizeFields = {
  durationSeconds: number | null;
  chapters: AudiobookChapter[] | null;
  narrators: string[];
  abridged: boolean | null;
};

function resolveAudioFinalizeFields(
  embedded: BookDockMetadata | null | undefined,
  selected: BookDockMetadata | null | undefined,
): AudioFinalizeFields {
  const normalizedEmbedded = normalizeBookDockMetadata(embedded);
  const normalizedSelected = normalizeBookDockMetadata(selected);
  return {
    durationSeconds: normalizeDurationSeconds(
      normalizedSelected?.durationSeconds !== undefined ? normalizedSelected.durationSeconds : normalizedEmbedded?.durationSeconds,
    ),
    chapters: normalizeChapters(normalizedSelected?.chapters !== undefined ? normalizedSelected.chapters : normalizedEmbedded?.chapters),
    narrators: normalizeStringArray(normalizedSelected?.narrators !== undefined ? normalizedSelected.narrators : normalizedEmbedded?.narrators, 500),
    abridged: normalizeAbridged(normalizedSelected?.abridged !== undefined ? normalizedSelected.abridged : normalizedEmbedded?.abridged),
  };
}

function buildAudioMetadataPatch(audio: AudioFinalizeFields): { durationSeconds?: number; chapters?: AudiobookChapter[]; abridged?: boolean } {
  const patch: { durationSeconds?: number; chapters?: AudiobookChapter[]; abridged?: boolean } = {};
  if (audio.durationSeconds !== null) patch.durationSeconds = audio.durationSeconds;
  if (audio.chapters !== null) patch.chapters = audio.chapters;
  if (audio.abridged !== null) patch.abridged = audio.abridged;
  return patch;
}

function normalizeAbridged(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeDurationSeconds(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.trim()) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function normalizeChapters(value: unknown): AudiobookChapter[] | null {
  if (!Array.isArray(value)) return null;
  const chapters: AudiobookChapter[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { title?: unknown; startMs?: unknown };
    const startMs =
      typeof candidate.startMs === 'number'
        ? candidate.startMs
        : typeof candidate.startMs === 'string'
          ? Number.parseFloat(candidate.startMs.trim())
          : NaN;
    if (!Number.isFinite(startMs) || startMs < 0) continue;
    const title = typeof candidate.title === 'string' ? candidate.title : '';
    chapters.push({ title, startMs: Math.round(startMs) });
  }
  return chapters.length > 0 ? chapters : null;
}

function resolveFinalizeErrorMessage(error: unknown): string {
  if (isPublishedYearConstraintViolation(error)) {
    return INVALID_PUBLISHED_YEAR_MESSAGE;
  }
  if (isBookMetadataConstraintViolation(error)) {
    return INVALID_METADATA_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Finalization failed';
}

function isPublishedYearConstraintViolation(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry.code === '23514') {
      const constraint = asString(entry.constraint);
      if (constraint === PUBLISHED_YEAR_RANGE_CONSTRAINT) return true;
      const message = asString(entry.message);
      if (message.includes(PUBLISHED_YEAR_RANGE_CONSTRAINT)) return true;
    }
  }
  return false;
}

function isBookMetadataConstraintViolation(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry.code !== '23514') continue;
    const constraint = asString(entry.constraint);
    if (constraint.startsWith('book_metadata_')) return true;
    const message = asString(entry.message);
    if (message.includes('book_metadata')) return true;
  }
  return false;
}

function* iterateErrorChain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mergeBookDockMetadata(
  embedded: BookDockMetadata | null | undefined,
  fetched: BookDockMetadata | null | undefined,
  selected: BookDockMetadata | null | undefined,
): BookDockMetadata | null {
  const merged: BookDockMetadata = {
    ...(normalizeBookDockMetadata(embedded) ?? {}),
    ...(normalizeBookDockMetadata(fetched) ?? {}),
    ...(normalizeBookDockMetadata(selected) ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAutoFinalizeMetadata(
  mode: BookDockAutoFinalizeMetadataMode,
  embedded: BookDockMetadata | null | undefined,
  fetched: BookDockMetadata | null | undefined,
  selected: BookDockMetadata | null | undefined,
): BookDockMetadata | null {
  if (mode === 'embedded_only') return mergeBookDockMetadata(embedded, null, selected);
  if (mode === 'fetched_only') return mergeBookDockMetadata(null, fetched, selected);
  return mergeBookDockMetadata(embedded, fetched, selected);
}

function shouldAutoFinalize(row: BookDockFileRow, mode: BookDockAutoFinalizeMetadataMode, threshold: number): boolean {
  if (mode === 'embedded_only') {
    return row.status === 'ready';
  }
  return row.confidence !== null && row.confidence >= threshold;
}

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids)];
}
