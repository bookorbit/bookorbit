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
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { access as fsAccess, readFile, rmdir, stat, unlink } from 'fs/promises';
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
import {
  DEFAULT_FORMAT_PRIORITY,
  isAudioFormat,
  MetadataProviderKey,
  NotificationType,
  parseSeriesIndex,
  Permission,
  resolveUploadPath,
} from '@bookorbit/types';
import type { BookRequestImportFormats } from '@bookorbit/types';
import type { FileRole } from '../scanner/lib/classify';
import { BookReadService } from '../book/book-read.service';
import { NotificationService } from '../notification/notification.service';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveExistingPathSpelling } from '../../common/utils/path-identity.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { buildPatternTokens } from '../../common/utils/pattern-tokens.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, libraries, libraryFolders } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { UploadProcessorService, type UnitBookFileInput, type UnitBookRecords } from '../upload/upload-processor.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED } from './book-dock-events.service';
import { BookDockGateway } from './book-dock.gateway';
import { normalizeBookDockMetadata } from './book-dock-metadata.utils';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWorkQueue } from './book-dock-work-queue';
import type { BookDockFileRow, BookDockUnitFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type LibraryRow = typeof libraries.$inferSelect;
type LibraryFolderRow = typeof libraryFolders.$inferSelect;
type NamingLibrary = { name?: string | null; fileNamingPattern?: string | null; organizationMode?: string | null };

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
const INTERNAL_FAILURE_MESSAGE = 'Filing this book failed inside BookOrbit. Check the server log for the cause.';
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
  seriesIndex: string | null;
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

type PlacedUnitFile = {
  sourcePath: string;
  destPath: string;
  format: string | null;
  role: FileRole;
  sortOrder: number | null;
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
  /** Every file this row places, primary first. One entry for an ordinary single-file row. */
  placement?: PlacedUnitFile[];
  /**
   * The folder every file of the unit shares, which is what `books.folderPath` has to be. Not the
   * primary's own directory: a disc-foldered unit puts the primary inside `CD 1`, and taking the
   * dirname there would file the book under the disc rather than under the book.
   */
  bookFolderPath?: string;
};

/**
 * What of a unit actually gets placed, given the target library and the instance's format setting.
 *
 * Two separate rules meet here. A `book_per_file` library cannot hold a multi-file book at all:
 * `folderPath` is the file's own path, and `findLooseFileCandidates` emits one candidate per
 * primary file while intentionally discarding covers and sidecars, so placing a folder there is
 * not a preference but data loss on the next scan. The format setting is the operator's own
 * choice about editions, and applies in both modes.
 *
 * Multipart audio is never reduced by either: its parts are one book, not competing editions, so
 * where it cannot be represented it holds for a human rather than importing a third of a book.
 */
function reduceUnitForLibrary(
  unitFiles: BookDockUnitFileRow[],
  library: LibraryRow,
  importFormats: BookRequestImportFormats,
): { files: BookDockUnitFileRow[]; hold?: string } {
  if (unitFiles.length === 0) return { files: unitFiles };

  const content = unitFiles.filter((file) => file.role === 'content');
  const looseFileLibrary = library.organizationMode === 'book_per_file';
  // Sidecars have nowhere to live in a loose-file library, which is exactly what the scanner does
  // with them there too.
  const kept = looseFileLibrary ? content : unitFiles;
  if (content.length <= 1) return { files: kept };

  const multipartAudio = content.every((file) => file.format !== null && isAudioFormat(file.format));
  if (multipartAudio) {
    if (!looseFileLibrary) return { files: kept };
    return {
      files: content,
      hold: `This is one audiobook in ${content.length} parts, and "${library.name}" stores one book per file. Choose a library that stores one book per folder.`,
    };
  }

  if (importFormats === 'all') return { files: kept };

  const priority = library.formatPriority?.length ? library.formatPriority : [...DEFAULT_FORMAT_PRIORITY];
  const best = [...content].sort((a, b) => formatRank(a.format, priority) - formatRank(b.format, priority))[0]!;
  // The chosen format keeps the artwork and sidecars that came with the unit; the other formats go.
  return { files: looseFileLibrary ? [best] : [best, ...unitFiles.filter((file) => file.role !== 'content')] };
}

function formatRank(format: string | null, priority: string[]): number {
  if (!format) return Number.MAX_SAFE_INTEGER;
  const index = priority.indexOf(format.toLowerCase());
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * The folder a unit lands in. Normally the directory of the pattern result, but a pattern with no
 * path separator resolves to a bare filename whose `dirname()` is the library folder root - which
 * would drop every unit there and merge unrelated books into one. So a directoryless result falls
 * back to a folder named for the file, matching what `book_per_folder` does by default.
 */
function unitDestinationFolder(destPath: string, folderPath: string): string {
  const parent = dirname(destPath);
  if (resolve(parent) !== resolve(folderPath)) return parent;
  return join(folderPath, basename(destPath, extname(destPath)));
}

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
    canManageAll: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
    needsReview?: boolean,
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
          needsReview,
          userId,
          canManageAll,
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
        const rows = await this.repo.findByIds(batch, userId, canManageAll);
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

    this.emitChange();

    this.notificationService
      .notify({
        type: failed > 0 ? NotificationType.BookDockFinalizedWithErrors : NotificationType.BookDockFinalized,
        title: failed > 0 ? 'Book Dock finalization completed with errors' : 'Book Dock finalization completed',
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

      const { destPath, folder, library, format, placement } = analysis;
      if (!destPath || !folder || !library || !format || !placement) {
        return { fileId: row.id, fileName: row.fileName, success: false, message: 'Finalization target could not be resolved' };
      }

      // Every file of the unit, or the single file that is the whole unit. Moved one at a time and
      // remembered as they land, so a failure part-way can put back exactly what was moved.
      const moved: Array<{ from: string; to: string }> = [];
      try {
        for (const file of placement) {
          await this.storage.moveToPath(file.sourcePath, file.destPath);
          moved.push({ from: file.destPath, to: file.sourcePath });
        }
      } catch (err) {
        await this.undoMoves(moved);
        throw err;
      }

      const persistedDestPath = (await resolveExistingPathSpelling(destPath, folder.path)) ?? destPath;

      let bookId: number;
      let written: UnitBookRecords | null = null;
      try {
        // The primary is first and the siblings after, because the book row that carries
        // `primaryFileId` is the one created for the first file. Ordering here is the whole
        // mechanism by which a 31-track audiobook points at track one rather than at whichever
        // row happened to insert first.
        written = await this.createUnitBookRecord(library, folder, placement, persistedDestPath, format, preparedAnalysis.bookFolderPath);
        bookId = written.bookIds[0]!;
        // Several ids only in a loose-file library, where each format is its own book. They are the
        // same work, so they get the same metadata rather than one of them getting all of it.
        for (const created of written.bookIds) await this.applyMetadata(created, row);
      } catch (err) {
        // The books committed before the failure, and metadata runs against services that cannot
        // join that transaction, so the compensation is explicit: take back exactly what this unit
        // wrote, then put the files back where they came from.
        if (written) await this.undoUnitBookRecords(written, row.id);
        await this.undoMoves(moved);
        throw err;
      }

      await this.cleanupBookDockRecord(row);
      existingDestinations.set(this.destinationKey(library.id, destPath), bookId);
      existingDestinations.set(this.destinationKey(library.id, persistedDestPath), bookId);

      const newName = persistedDestPath.substring(folder.path.length + 1);
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
    canManageAll: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
    needsReview?: boolean,
  ): Promise<BookDockFinalizePreviewResult> {
    const summary = createFinalizePreviewSummary();
    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));

    await this.processFinalizeSelection(
      userId,
      canManageAll,
      fileIds,
      selectAll,
      excludedIds,
      status,
      search,
      needsReview,
      async (rows, missingIds) => {
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
      },
    );

    return summary;
  }

  async discardDuplicateCandidates(
    userId: number,
    isSuperuser: boolean,
    canManageAll: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrides?: Array<{ fileId: number } & FinalizeOverrideEntry>,
    status?: string,
    search?: string,
    needsReview?: boolean,
  ): Promise<BookDockDiscardDuplicatesResult> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.discard_duplicates] [start] userId=${userId} selectAll=${selectAll === true} - duplicate discard started`);

    const overrideMap = new Map((overrides ?? []).map((o) => [o.fileId, o]));
    let total = 0;
    let discarded = 0;
    const discardedFileIds: number[] = [];

    try {
      await this.processFinalizeSelection(
        userId,
        canManageAll,
        fileIds,
        selectAll,
        excludedIds,
        status,
        search,
        needsReview,
        async (rows, missingIds) => {
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
        },
      );

      this.emitChange();
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

      const unitFiles = row.unitDirectory ? await this.repo.findUnitFiles(row.id) : [];
      const reduced = reduceUnitForLibrary(unitFiles, library, await this.appSettings.getBookRequestImportFormats());
      if (reduced.hold) {
        return { fileId: row.id, fileName: row.fileName, row, status: 'unsupported_layout', message: reduced.hold };
      }

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

      const { files: placement, bookFolderPath } = this.resolvePlacement(row, reduced.files, destPath, folder.path, library);
      // The primary's own destination follows the placement, which for a unit means it sits inside
      // the unit folder rather than at the path the naming pattern produced directly.
      destPath = placement[0]!.destPath;

      const newName = destPath.substring(folder.path.length + 1);

      return { fileId: row.id, fileName: row.fileName, row, status: 'ready', newName, library, folder, format, destPath, placement, bookFolderPath };
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

  /**
   * Where each file of the unit lands. A single-file row keeps today's rename-by-pattern exactly,
   * so nothing about an ordinary upload changes. A unit takes the **directory** of the pattern
   * result and keeps the original file names inside it: the scanner recovers track order from
   * those names, and renaming tracks by pattern would need an index token for no gain.
   */
  private resolvePlacement(
    row: BookDockFileRow,
    unitFiles: BookDockUnitFileRow[],
    destPath: string,
    folderPath: string,
    library: LibraryRow,
  ): { files: PlacedUnitFile[]; bookFolderPath: string } {
    if (unitFiles.length === 0) {
      return {
        files: [{ sourcePath: row.absolutePath, destPath, format: row.format, role: 'content', sortOrder: 0 }],
        bookFolderPath: library.organizationMode === 'book_per_file' ? destPath : dirname(destPath),
      };
    }

    const primaryIndex = unitFiles.findIndex((file) => file.absolutePath === row.absolutePath);
    // Primary first: `createBookRecord` sets `primaryFileId` only on the call that creates the book.
    const ordered = primaryIndex > 0 ? [unitFiles[primaryIndex]!, ...unitFiles.filter((_, index) => index !== primaryIndex)] : unitFiles;

    // A loose-file library has no folder to put a unit in: what survives the reduction lands flat,
    // each file taking the pattern's own name with its own extension, so the formats stay siblings
    // rather than one of them keeping a name that belongs to another.
    if (library.organizationMode === 'book_per_file') {
      const stem = basename(destPath, extname(destPath));
      return {
        files: ordered.map((file, index) => ({
          sourcePath: file.absolutePath,
          destPath: index === 0 ? destPath : join(dirname(destPath), this.validator.sanitizeFilename(`${stem}${extname(file.fileName)}`)),
          format: file.format,
          role: (file.role as FileRole) ?? 'content',
          sortOrder: file.sortOrder,
        })),
        bookFolderPath: destPath,
      };
    }

    const destinationFolder = unitDestinationFolder(destPath, folderPath);
    return {
      files: ordered.map((file) => ({
        sourcePath: file.absolutePath,
        // The path *within* the unit, not the bare file name: a two-disc audiobook holds two files
        // called `track01.mp3`, and flattening them makes the second overwrite the first.
        destPath: join(destinationFolder, this.unitRelativeName(row, file)),
        format: file.format,
        role: (file.role as FileRole) ?? 'content',
        sortOrder: file.sortOrder,
      })),
      bookFolderPath: destinationFolder,
    };
  }

  /** Each segment sanitized on its own, so the subdirectory survives rather than the separator. */
  private unitRelativeName(row: BookDockFileRow, file: BookDockUnitFileRow): string {
    if (!row.unitDirectory) return this.validator.sanitizeFilename(file.fileName);
    const within = relative(row.unitDirectory, file.absolutePath);
    if (!within || within.startsWith('..') || isAbsolute(within)) return this.validator.sanitizeFilename(file.fileName);
    return within
      .split(sep)
      .map((segment) => this.validator.sanitizeFilename(segment))
      .join(sep);
  }

  /** Undoes a part-placed unit. Never throws: it runs while another error is on its way up. */
  private async undoMoves(moved: Array<{ from: string; to: string }>): Promise<void> {
    for (const move of moved) {
      await this.storage.moveToPath(move.from, move.to).catch(() => {});
    }
  }

  /**
   * Turns a placed unit into book rows. In `book_per_folder` every file shares one `folderPath`,
   * so `createBookRecord` folds them into a single book. In `book_per_file` each file *is* its own
   * folderPath, so several formats become several books - which is that mode's normal state, and
   * what its next scan would produce anyway.
   *
   * Returns every book created, primary first, so the caller can give each one the metadata: two
   * extra books with the same title and none of its metadata would be worse than not importing
   * them at all.
   */
  private async createUnitBookRecord(
    library: LibraryRow,
    folder: LibraryFolderRow,
    placement: PlacedUnitFile[],
    persistedPrimaryPath: string,
    primaryFormat: string,
    bookFolderPath: string | undefined,
  ): Promise<UnitBookRecords> {
    if (placement.length === 0) throw new Error('Finalization placed no files');

    const loose = library.organizationMode === 'book_per_file';
    const sharedFolderPath = bookFolderPath ?? dirname(persistedPrimaryPath);
    const files: UnitBookFileInput[] = [];

    for (const [index, file] of placement.entries()) {
      const absolutePath = index === 0 ? persistedPrimaryPath : file.destPath;
      const format = index === 0 ? primaryFormat : (file.format ?? extname(absolutePath).toLowerCase().slice(1));
      const { size } = await stat(absolutePath);
      files.push({
        folderPath: loose ? absolutePath : sharedFolderPath,
        absolutePath,
        relPath: absolutePath.substring(folder.path.length + 1),
        format,
        sizeBytes: size,
        role: file.role,
        sortOrder: file.sortOrder,
      });
    }

    return this.processor.createUnitBookRecords(library.id, folder.id, files);
  }

  /** Never throws: it runs while the error that caused it is already on its way up. */
  private async undoUnitBookRecords(written: UnitBookRecords, dockFileId: number): Promise<void> {
    try {
      await this.processor.deleteUnitBookRecords(written);
    } catch (err) {
      this.logger.error(
        `[book_dock.finalize_rollback] [fail] dockFileId=${dockFileId} bookIds=${written.createdBookIds.join(',')} error="${sanitizeLogValue(
          err instanceof Error ? err.message : String(err),
        )}" - could not take back the book rows this unit created`,
      );
    }
  }

  private async classifyDestination(
    analysis: FinalizeCandidateAnalysis,
    existingDestinations: Map<string, number>,
  ): Promise<FinalizeCandidateAnalysis> {
    if (analysis.status !== 'ready' || !analysis.destPath || !analysis.library) return analysis;

    // Every target path of a unit, not only the primary's: a folder that collides on track 7 is
    // just as unplaceable as one that collides on track 1.
    for (const file of analysis.placement ?? []) {
      if (file.destPath === analysis.destPath) continue;
      const taken = await fsAccess(file.destPath).then(
        () => true,
        () => false,
      );
      if (taken) {
        return { ...analysis, status: 'destination_conflict', message: 'A file with this name already exists at the target location' };
      }
    }

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
    canManageAll: boolean,
    fileIds: number[] | undefined,
    selectAll: boolean | undefined,
    excludedIds: number[] | undefined,
    status: string | undefined,
    search: string | undefined,
    needsReview: boolean | undefined,
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
          needsReview,
          userId,
          canManageAll,
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
      const rows = await this.repo.findByIds(batch, userId, canManageAll);
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
    // Another module put this row here and runs its own checks before filing it. Racing it would
    // either file the wrong book into the right library or file it before those checks ran.
    if (row.autoFinalizeSuppressed) return;
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
      this.emitChange();

      this.notificationService
        .notify({
          type: NotificationType.BookDockFinalized,
          title: 'Book auto-finalized',
          message: `"${row.fileName}" was added to your library`,
          scope: row.uploadedBy ? { kind: 'user', userId: row.uploadedBy } : { kind: 'permission', permission: Permission.ManageBookDock },
          meta: { fileId, bookId: result.bookId },
        })
        .catch(() => {});
    } else {
      this.logger.warn(`Auto-finalize skipped for Book Dock file ${fileId}: ${result.message}`);
    }
  }

  /**
   * Finalize one row on behalf of the module that owns it, after that module's own verification
   * has passed. Deliberately not the public `finalize()`: that one is a user-initiated batch and
   * announces itself with a "finalization completed" notification, which is not what a request
   * landing in a library should say.
   *
   * Metadata is merged the same way the standard path merges it, rather than following the Book
   * Dock's auto-finalize metadata mode: that mode is an operator preference about unattended dock
   * files, and it does not govern a file another module vouched for.
   */
  async finalizeManagedFile(fileId: number, override: { libraryId?: number; folderId?: number }): Promise<BookDockFinalizeFileResult> {
    const row = await this.repo.findById(fileId);
    if (!row) {
      return { fileId, fileName: `book-dock-file-${fileId}`, success: false, message: 'Book Dock file not found' };
    }

    const merged = mergeBookDockMetadata(row.embeddedMetadata, row.fetchedMetadata, row.selectedMetadata);
    const rowForFinalize = merged ? { ...row, selectedMetadata: merged } : row;

    const overrideMap = new Map<number, FinalizeOverrideEntry>();
    if (override.libraryId !== undefined || override.folderId !== undefined) {
      overrideMap.set(fileId, { libraryId: override.libraryId, folderId: override.folderId });
    }

    const result = await this.finalizeFile(rowForFinalize, undefined, undefined, overrideMap, 0, true);
    if (result.success) this.emitChange();
    return result;
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
        canManageAll: true,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.autoFinalizeSuppressed) continue;
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
    canManageAll: boolean | undefined,
    status?: string,
    search?: string,
    needsReview?: boolean,
  ): Promise<{ fileId: number; fileName: string; newName: string }[]> {
    const ids = selectAll ? await this.repo.findAllIds(excludedIds, status, search, userId, canManageAll, needsReview) : (fileIds ?? []);
    if (!ids.length) return [];

    const rows = await this.repo.findByIds(ids, userId, canManageAll);
    const appPatternFile = await this.appSettings.getUploadPattern();
    const appPatternFolder = await this.appSettings.getUploadPatternBookPerFolder();
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const libraryIds = [...new Set(rows.map((row) => row.targetLibraryId ?? defaultLibraryId).filter((id): id is number => id != null))];
    const libraryMap = libraryIds.length
      ? new Map((await this.db.select().from(libraries).where(inArray(libraries.id, libraryIds))).map((lib) => [lib.id, lib]))
      : new Map<number, typeof libraries.$inferSelect>();

    return rows.map((row) => {
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      const effectiveLibraryId = row.targetLibraryId ?? defaultLibraryId ?? null;
      const lib = effectiveLibraryId !== null ? libraryMap.get(effectiveLibraryId) : undefined;
      const pattern = lib?.fileNamingPattern ?? (lib?.organizationMode === 'book_per_folder' ? appPatternFolder : appPatternFile);
      const newName = this.resolveRelativeDestination(lib, row, format, pattern, sanitizeForCrossPlatform);

      return { fileId: row.id, fileName: row.fileName, newName };
    });
  }

  private async resolveDestination(library: NamingLibrary, folderPath: string, row: BookDockFileRow, format: string): Promise<string> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();

    return join(folderPath, this.resolveRelativeDestination(library, row, format, pattern, sanitizeForCrossPlatform));
  }

  /**
   * Where a docked file belongs under its library folder. The finalize move and the name
   * preview both go through here so they cannot disagree about the destination.
   *
   * Both organization modes keep the pattern's folder segments, matching the rename and move
   * services; `book_per_file` differs only in that the file itself is the book, so without a
   * pattern it stays where it is instead of gaining a folder of its own.
   */
  private resolveRelativeDestination(
    library: NamingLibrary | undefined,
    row: BookDockFileRow,
    format: string,
    pattern: string | null,
    sanitizeForCrossPlatform: boolean,
  ): string {
    if (pattern) {
      const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};
      const tokens = this.buildFilePatternTokens(meta, row.fileName, format, library?.name);
      const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
      if (resolved) return resolved;
    }

    if (library?.organizationMode === 'book_per_folder') {
      return join(basename(row.fileName, extname(row.fileName)), row.fileName);
    }

    return row.fileName;
  }

  private buildFilePatternTokens(meta: BookDockMetadata, fileName: string, format: string, libraryName?: string | null): Record<string, string> {
    return buildPatternTokens({
      metadata: meta,
      authors: meta.authors,
      narrators: meta.narrators,
      originalStem: basename(fileName, extname(fileName)),
      format,
      libraryName,
    });
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
    // The unit's files have all been moved into the library by now, so what is left is the empty
    // directory they came out of. The child rows go with the anchor via the cascade.
    if (row.unitDirectory) await removeEmptyDirectory(row.unitDirectory);
    await this.repo.deleteById(row.id);
  }

  /** Discarding a unit throws away every file in it. Discarding track 1 of 31 is not a thing. */
  private async cleanupDiscardedBookDockFile(row: BookDockFileRow): Promise<void> {
    if (row.unitDirectory) {
      for (const file of await this.repo.findUnitFiles(row.id)) await safeUnlink(file.absolutePath);
      await removeEmptyDirectory(row.unitDirectory);
    }
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

  private emitChange(): void {
    this.gateway.emitChanged();
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // file may already be deleted
  }
}

/**
 * Deliberately non-recursive. A directory that still holds files is one the dock did not fully
 * account for, and leaving it for a human to look at is far better than deleting what is in it.
 */
async function removeEmptyDirectory(path: string): Promise<void> {
  await rmdir(path).catch(() => {});
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
    seriesIndex: parseSeriesIndex(normalizedMeta?.seriesIndex),
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
    memberships.push({ seriesName, seriesIndex: parseSeriesIndex(item.seriesIndex) });
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
  // A database error is not a sentence for a requester to read. One shipped verbatim - a whole
  // failed SELECT, table and column names included - into the request drawer of the person who
  // asked for the book. The detail belongs in the log, which already has the original error.
  if (isDatabaseError(error)) {
    return INTERNAL_FAILURE_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Finalization failed';
}

/**
 * A `pg` error carries a five-character SQLSTATE. Drizzle wraps it in a `DrizzleQueryError` whose
 * own message is the failed query, so the chain is walked rather than the outermost error read.
 */
function isDatabaseError(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (/^[0-9A-Z]{5}$/.test(asString(entry.code))) return true;
  }
  return false;
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
