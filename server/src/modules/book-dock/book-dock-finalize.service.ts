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
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseError } from 'pg';

import type {
  AudiobookChapter,
  AudiobookChapterSource,
  BookDockAutoFinalizeMetadataMode,
  BookDockDiscardDuplicatesResult,
  BookDockFinalizeFileResult,
  BookDockFinalizePreviewItem,
  BookDockFinalizePreviewResult,
  BookDockFinalizePreviewStatus,
  BookDockFinalizeResult,
  BookDockHoldDetail,
  BookDockHoldReason,
  BookDockEffectiveSettings,
  BookDockJoinBook,
  BookDockJoinErrorCode,
  BookDockJoinSuggestion,
  BookDockMetadata,
  ComicMetadataFields,
  MetadataSeriesMembership,
} from '@bookorbit/types';
import {
  formatKeyRank,
  isAudioFormat,
  MetadataProviderKey,
  isMetadataProviderKeySyntax,
  normalizeFormatPriority,
  NotificationType,
  parseSeriesIndex,
  Permission,
  resolveUploadPath,
} from '@bookorbit/types';
import type { BookRequestImportFormats, CoverMedium } from '@bookorbit/types';
import type { FileRole } from '../scanner/lib/classify';
import type { RequestUser } from '../../common/types/request-user';
import { ProviderIdStore } from '../metadata-fetch/provider-ids/provider-id.store';
import { BookReadService } from '../book/book-read.service';
import { NotificationService } from '../notification/notification.service';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { chapterProvenance, normalizeAudiobookChapters } from '../../common/utils/audiobook-chapters.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveExistingPathSpelling } from '../../common/utils/path-identity.utils';
import { resolveSingleFileBookPath } from '../../common/utils/book-path.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { buildPatternTokens, patternReferencesToken } from '../../common/utils/pattern-tokens.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, bookNarrators, libraries, libraryFolders } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { FileWriteService } from '../file-write/file-write.service';
import { LibraryService } from '../library/library.service';
import { UserService } from '../user/user.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { UploadProcessorService, type UnitBookFileInput, type UnitBookRecords } from '../upload/upload-processor.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { inspectEpubMediaOverlayFields } from '../reader/epub/epub-media-overlay-capability';
import { BookDockRepository, type BookDockFilter } from './book-dock.repository';
import { BookDockDuplicateService, IDENTIFIER_MATCH_REASONS, type DuplicateMatch } from './book-dock-duplicate.service';
import { BookDockKeptFilesService } from './book-dock-kept-files.service';
import { BookDockDigestService } from './book-dock-digest.service';
import { BookDockEventsService, BOOK_DOCK_FILE_INGESTED, type BookDockOwnedFileExitReport } from './book-dock-events.service';
import { BookDockGateway } from './book-dock.gateway';
import {
  BookDockJoinService,
  hasFolderOfItsOwn,
  joinError,
  joinErrorCodeOf,
  type JoinSuggestionInput,
  type ResolvedJoinTarget,
} from './book-dock-join.service';
import { normalizeBookDockMetadata } from './book-dock-metadata.utils';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWorkQueue } from './book-dock-work-queue';
import { LibraryDockRegistry } from './library-dock-registry.service';
import { resolveDockSettings } from './library-dock-settings';
import type { BookDockFileRow, BookDockUnitFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type LibraryRow = typeof libraries.$inferSelect;
type LibraryFolderRow = typeof libraryFolders.$inferSelect;
type NamingLibrary = { name?: string | null; fileNamingPattern?: string | null; organizationMode?: string | null };

type JoinBook = { bookId: number; folderPath: string; coverUrl?: string | null; storedAsFile?: boolean };

/** A per-file override as a finalize request states it. */
export type FinalizeRequestOverride = {
  fileId: number;
  libraryId?: number;
  folderId?: number;
  targetFileName?: string;
  joinBook?: { bookId: number };
};

type FinalizeOverrideEntry = {
  libraryId?: number;
  folderId?: number;
  targetFileName?: string;
  /**
   * An existing book this file should become another format of, by landing in that book's own
   * folder. Honoured only where a folder is a book; anywhere else the file is filed as usual.
   * `coverUrl` is the art chosen for this format when it was asked for, used only when the arriving
   * files carry none of their own.
   */
  joinBook?: JoinBook;
  /**
   * A book a person picked for this file. Unlike `joinBook`, which another module resolved and
   * vouches for, this is checked against the person before anything moves, and a refusal holds the
   * file instead of filing it somewhere else.
   */
  requestedJoinBookId?: number;
  /** A cover the metadata lookup found by itself, rather than one a person picked. See `applyMetadata`. */
  lookedUpCoverUrl?: string | null;
};

type PreviewJoinInfo = { canJoinBook: boolean; suggestedJoinBook?: BookDockJoinSuggestion };

type AutoFileHold = { reason: BookDockHoldReason; detail: BookDockHoldDetail | null };

/** What the auto-file check concluded for one file: wait (with the reason, when there is one), or file it as prepared. */
type AutoFileDecision =
  | { kind: 'wait'; hold: AutoFileHold | null }
  | { kind: 'file'; analysis: FinalizeCandidateAnalysis; existingDestinations: Map<string, number>; join: DuplicateMatch | null };

const NO_DEFAULT_DESTINATION = { libraryId: null, folderId: null };

/** The hold a finalize preview status stands for. `error` has none: it is logged where it happens. */
const HOLD_FOR_PREVIEW_STATUS: Partial<Record<BookDockFinalizePreviewStatus, BookDockHoldReason>> = {
  missing_destination: 'no_destination',
  invalid_target: 'no_folder',
  invalid_format: 'not_allowed_in_library',
  unsupported_layout: 'unsupported_layout',
  access_denied: 'waiting_for_manager',
  duplicate: 'duplicate',
  destination_conflict: 'destination_conflict',
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

type NormalizedFinalizeMetadata = {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  originalPublishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: string | null;
  authors: string[];
  genres: string[];
  tags: string[];
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
  externalProviderIds: Partial<Record<string, string>> | undefined;
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
  /** The existing book this file was placed into the folder of, when it was asked to join one. */
  joinBook?: JoinBook;
  /** How a book a person picked reads in the preview. */
  joinSummary?: BookDockJoinBook;
  errorCode?: BookDockJoinErrorCode;
  lookedUpCoverUrl?: string | null;
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

  const priority = normalizeFormatPriority(library.formatPriority);
  const best = [...content].sort((a, b) => formatRank(a.format, priority) - formatRank(b.format, priority))[0]!;
  // The chosen format keeps the artwork and sidecars that came with the unit; the other formats go.
  return { files: looseFileLibrary ? [best] : [best, ...unitFiles.filter((file) => file.role !== 'content')] };
}

/** Dock files are not inspected for media overlays yet, so an EPUB ranks by the plain `epub` entry. */
function formatRank(format: string | null, priority: readonly string[]): number {
  return format ? formatKeyRank(format.toLowerCase(), priority) : Number.MAX_SAFE_INTEGER;
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
  /** Works out again why files wait, after an edit. Never files anything. */
  private readonly holdReviewQueue: BookDockWorkQueue;

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
    private readonly fileWriteService: FileWriteService,
    private readonly dockRegistry: LibraryDockRegistry,
    private readonly duplicates: BookDockDuplicateService,
    private readonly users: UserService,
    private readonly keptFiles: BookDockKeptFilesService,
    private readonly digest: BookDockDigestService,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
    @Optional() private readonly providerIdStore?: ProviderIdStore,
    @Optional() private readonly joinService?: BookDockJoinService,
  ) {
    this.autoFinalizeQueue = new BookDockWorkQueue(
      AUTO_FINALIZE_QUEUE_CONCURRENCY,
      (fileId) => this.triggerAutoFinalize(fileId),
      (fileId, error) => this.logAutoFinalizeQueueFailure(fileId, error),
    );
    this.holdReviewQueue = new BookDockWorkQueue(
      AUTO_FINALIZE_QUEUE_CONCURRENCY,
      (fileId) => this.reviewHold(fileId),
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
      this.holdReviewQueue.pause();
    }
  }

  onModuleDestroy(): void {
    this.autoFinalizeQueue.stop();
    this.holdReviewQueue.stop();
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
    overrides?: FinalizeRequestOverride[],
    status?: string,
    search?: string,
    needsReview?: boolean,
    readyToFile?: boolean,
    requester?: RequestUser,
    filter?: BookDockFilter,
  ): Promise<BookDockFinalizeResult> {
    const ids = selectAll ? [] : dedupeIds(fileIds ?? []);
    const overrideMap = toOverrideMap(overrides);

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
          readyToFile,
          filter,
          userId,
          canManageAll,
        });
        if (rows.length === 0) break;

        const reportExit = await this.events.beforeOwnedFilesExit(rows);
        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, requester);
        for (const analysis of prepared.analyses) {
          const result = await this.fileForPerson(analysis, prepared.existingDestinations, reportExit);
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
        const reportExit = await this.events.beforeOwnedFilesExit(rows);
        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, requester);
        const analysisById = new Map(prepared.analyses.map((analysis) => [analysis.fileId, analysis]));

        for (const fileId of batch) {
          const analysis = analysisById.get(fileId);
          if (!analysis) {
            failed++;
            results.push({
              fileId,
              fileName: `book-dock-file-${fileId}`,
              success: false,
              message: 'Library Dock file not found',
            });
            continue;
          }

          const result = await this.fileForPerson(analysis, prepared.existingDestinations, reportExit);
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
        title: failed > 0 ? 'Library Dock finalization completed with errors' : 'Library Dock finalization completed',
        message: `${succeeded} succeeded, ${failed} failed`,
        scope: { kind: 'user', userId },
        meta: { total: results.length, succeeded, failed },
      })
      .catch(() => {});

    return { total: results.length, succeeded, failed, results };
  }

  /**
   * A person's filing, which a module that owns the file has to hear about. Auto-file and
   * `finalizeManagedFile` never report: auto-file skips owned files, and the owner's own filing
   * already knows how it ended.
   */
  private async fileForPerson(
    analysis: FinalizeCandidateAnalysis,
    existingDestinations: Map<string, number>,
    reportExit: BookDockOwnedFileExitReport,
  ): Promise<BookDockFinalizeFileResult> {
    const result = await this.finalizePreparedCandidate(analysis, existingDestinations);
    if (result.success && result.bookId !== undefined) await reportExit(result.fileId, { kind: 'filed', bookId: result.bookId });
    return result;
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

      // Every file of the unit, or the single file that is the whole unit. Placed one at a time and
      // remembered as they land, so a failure part-way can undo exactly what was placed. A
      // keep-original dock links or copies instead of moving, and undoing that only ever removes
      // the library's copy: the original is never touched (D34).
      const keepOriginal = await this.keptFiles.keepsOriginals(row);
      const undo: Array<() => Promise<unknown>> = [];
      let copied = 0;
      const placeAndRecord = async () => {
        try {
          for (const file of placement) {
            if (keepOriginal) {
              if ((await this.storage.linkToPath(file.sourcePath, file.destPath)) === 'copied') copied++;
              undo.push(() => unlink(file.destPath));
            } else {
              await this.storage.moveToPath(file.sourcePath, file.destPath);
              undo.push(() => this.storage.moveToPath(file.destPath, file.sourcePath));
            }
          }
          const persistedPath = (await resolveExistingPathSpelling(destPath, folder.path)) ?? destPath;
          // The primary is first and the siblings after, because the book row that carries
          // `primaryFileId` is the one created for the first file. Ordering here is the whole
          // mechanism by which a 31-track audiobook points at track one rather than at whichever
          // row happened to insert first.
          const records = await this.createUnitBookRecord(library, folder, placement, persistedPath, format, preparedAnalysis.bookFolderPath);
          return { persistedPath, records };
        } catch (err) {
          await this.undoPlacement(undo);
          throw err;
        }
      };
      // A folder-per-book unit shares one folder, which may already be a book's: this file joining
      // it, or the naming pattern leading there. The files land in it under that book's lock.
      const sharedFolder = library.organizationMode === 'book_per_file' ? undefined : preparedAnalysis.bookFolderPath;
      const { persistedPath: persistedDestPath, records: written } = sharedFolder
        ? await this.processor.withFolderBookLock(library.id, sharedFolder, placeAndRecord, analysis.joinBook?.bookId)
        : await placeAndRecord();

      let bookId: number;
      try {
        bookId = written.bookIds[0]!;
        // Several ids only in a loose-file library, where each format is its own book. They are the
        // same work, so they get the same metadata rather than one of them getting all of it.
        for (const created of written.bookIds) {
          // Only a book this import created takes the file's metadata. One already on the shelf,
          // whether this file was asked to join it or the naming pattern just led to its folder,
          // keeps what it has, and the new format brings only what belongs to that format (#1568).
          if (!written.createdBookIds.includes(created)) {
            const requestedCoverUrl = created === analysis.joinBook?.bookId ? (analysis.joinBook.coverUrl ?? null) : null;
            await this.applyJoinedMetadata(created, row, requestedCoverUrl, analysis.lookedUpCoverUrl ?? null);
          } else await this.applyMetadata(created, row, created === bookId, analysis.lookedUpCoverUrl ?? null);
        }
      } catch (err) {
        // The books committed before the failure, and metadata runs against services that cannot
        // join that transaction, so the compensation is explicit: take back exactly what this unit
        // wrote, then put the files back where they came from.
        await this.undoUnitBookRecords(written, row.id);
        await this.undoPlacement(undo);
        throw err;
      }

      // After the metadata, whose duration it supersedes, and before any write-back touches the files.
      await this.measureAudioDurations(written.bookIds, row.id);
      this.processor.reconcileCoversAsync(written.bookIds);
      if (keepOriginal) {
        // Before the row goes: its unit membership is what says which files stay behind.
        await this.keptFiles.remember(row, { bookId });
        if (copied > 0) {
          this.logger.warn(
            `[book_dock.keep_original] [end] fileId=${row.id} bookId=${bookId} files=${placement.length} copied=${copied} - hardlink unavailable, copied instead; the file now uses disk space twice`,
          );
        }
      }
      await this.cleanupBookDockRecord(row);
      if (library.fileWriteEnabled) {
        for (const created of written.bookIds) {
          this.fileWriteService.scheduleWrite(created, 'auto', row.uploadedBy ?? undefined);
        }
      }
      existingDestinations.set(this.destinationKey(library.id, destPath), bookId);
      existingDestinations.set(this.destinationKey(library.id, persistedDestPath), bookId);
      if (analysis.joinSummary) {
        this.logger.log(
          `[book_dock.join_book] [end] fileId=${row.id} bookId=${analysis.joinSummary.bookId} landedBookId=${bookId} files=${placement.length} - filed as another format of an existing book`,
        );
      }

      const newName = persistedDestPath.substring(folder.path.length + 1);
      return { fileId: row.id, fileName: row.fileName, newName, success: true, bookId };
    } catch (err) {
      const message = resolveFinalizeErrorMessage(err);
      this.logFinalizeFailure(row.id, 'filing', err);
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
    overrides?: FinalizeRequestOverride[],
    status?: string,
    search?: string,
    needsReview?: boolean,
    readyToFile?: boolean,
    requester?: RequestUser,
    filter?: BookDockFilter,
  ): Promise<BookDockFinalizePreviewResult> {
    const summary = createFinalizePreviewSummary();
    const overrideMap = toOverrideMap(overrides);
    const joinAccess = new Map<number, Promise<boolean>>();

    await this.processFinalizeSelection(
      userId,
      canManageAll,
      fileIds,
      selectAll,
      excludedIds,
      status,
      search,
      needsReview,
      readyToFile,
      filter,
      async (rows, missingIds) => {
        const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, requester);
        const analyses: FinalizeCandidateAnalysis[] = [];
        for (const candidate of prepared.analyses) {
          analyses.push(await this.classifyDestination(candidate, prepared.existingDestinations));
        }
        // Only what the preview lists is worth a lookup: past the item limit nobody sees it.
        const listed = analyses.slice(0, Math.max(0, PREVIEW_ITEM_LIMIT - summary.items.length));
        const joinInfo = await this.describeJoins(listed, requester, joinAccess);
        for (const analysis of analyses) addFinalizePreviewAnalysis(summary, analysis, joinInfo.get(analysis.fileId));
        for (const fileId of missingIds) {
          addFinalizePreviewItem(summary, {
            fileId,
            fileName: `book-dock-file-${fileId}`,
            status: 'error',
            message: 'Library Dock file not found',
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
    overrides?: FinalizeRequestOverride[],
    status?: string,
    search?: string,
    needsReview?: boolean,
    readyToFile?: boolean,
    requester?: RequestUser,
    filter?: BookDockFilter,
  ): Promise<BookDockDiscardDuplicatesResult> {
    const startedAt = Date.now();
    this.logger.log(`[book_dock.discard_duplicates] [start] userId=${userId} selectAll=${selectAll === true} - duplicate discard started`);

    const overrideMap = toOverrideMap(overrides);
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
        readyToFile,
        filter,
        async (rows, missingIds) => {
          total += rows.length + missingIds.length;
          const prepared = await this.prepareFinalizeBatch(rows, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, requester);
          const duplicateRows: BookDockFileRow[] = [];

          for (const candidate of prepared.analyses) {
            const analysis = await this.classifyDestination(candidate, prepared.existingDestinations);
            if (analysis.status === 'duplicate') duplicateRows.push(candidate.row);
          }

          if (duplicateRows.length === 0) return;

          const reportExit = await this.events.beforeOwnedFilesExit(duplicateRows);
          const keepsOriginals = await this.keptFiles.keepOriginalCheck();
          for (const row of duplicateRows) {
            await this.cleanupDiscardedBookDockFile(row, await keepsOriginals(row));
            discardedFileIds.push(row.id);
          }
          await this.repo.deleteByIds(duplicateRows.map((row) => row.id));
          discarded += duplicateRows.length;
          for (const row of duplicateRows) await reportExit(row.id, { kind: 'discarded' });
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
    requester?: RequestUser,
  ): Promise<FinalizeCandidateAnalysis> {
    try {
      const override = overrideMap.get(row.id);
      const requestedJoin =
        override?.requestedJoinBookId !== undefined ? await this.resolveRequestedJoin(override.requestedJoinBookId, row, requester) : null;
      // The book decides the folder: its own lives under exactly one of the library's folders. A
      // file with no destination of its own takes the book's library too.
      const libraryId = override?.libraryId ?? row.targetLibraryId ?? defaultLibraryId ?? requestedJoin?.libraryId ?? null;
      const folderId = requestedJoin?.libraryFolderId ?? override?.folderId ?? row.targetFolderId ?? defaultFolderId ?? null;

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
      await this.libraryService.verifyAccess(requester ?? { id: userId, isSuperuser }, libraryId);
      if (requestedJoin && requestedJoin.libraryId !== libraryId) {
        throw joinError('BOOK_DOCK_JOIN_OTHER_LIBRARY', 'The book this file was meant to join is in a different library');
      }
      if (requestedJoin && library.organizationMode !== 'book_per_folder') {
        throw joinError('BOOK_DOCK_JOIN_FILE_PER_BOOK', `"${library.name}" stores one book per file, so a file cannot be added to an existing book`);
      }

      const folder = await this.findFolderOrFail(folderId, libraryId);
      const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
      this.validator.validateFormat(row.fileName, library.allowedFormats);

      const unitFiles = await this.repo.findUnitFiles(row.id);
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

      // Another format of a book already on the shelf goes into that book's folder under the name
      // the pattern gave it, so the scan and the importer agree it is one book. The pattern's own
      // folder would follow this file's metadata, and an m4b tagged "Dune (Unabridged)" names a
      // different folder from the epub called "Dune".
      const requestedJoinBook = requestedJoin
        ? { bookId: requestedJoin.bookId, folderPath: requestedJoin.folderPath, storedAsFile: requestedJoin.storedAsFile }
        : undefined;
      const joinBook = this.resolveJoinBook(requestedJoinBook ?? override?.joinBook, library, folder);
      if (requestedJoin && !joinBook) {
        throw joinError('BOOK_DOCK_JOIN_ROOT_LEVEL', 'The book this file was meant to join has no folder of its own to share');
      }
      if (joinBook) destPath = join(joinBook.folderPath, basename(destPath));

      const { files: placement, bookFolderPath } = this.resolvePlacement(row, reduced.files, destPath, folder.path, library);
      // The primary's own destination follows the placement, which for a unit means it sits inside
      // the unit folder rather than at the path the naming pattern produced directly.
      destPath = placement[0]!.destPath;

      const newName = destPath.substring(folder.path.length + 1);

      return {
        fileId: row.id,
        fileName: row.fileName,
        row,
        status: 'ready',
        newName,
        library,
        folder,
        format,
        destPath,
        placement,
        bookFolderPath,
        ...(joinBook ? { joinBook } : {}),
        ...(requestedJoin ? { joinSummary: requestedJoin.summary } : {}),
        ...(override?.lookedUpCoverUrl ? { lookedUpCoverUrl: override.lookedUpCoverUrl } : {}),
      };
    } catch (error) {
      const status = classifyFinalizePreviewError(error);
      if (status === 'error') this.logFinalizeFailure(row.id, 'target_resolution', error);
      const errorCode = joinErrorCodeOf(error);
      return {
        fileId: row.id,
        fileName: row.fileName,
        row,
        status,
        message: resolveFinalizeErrorMessage(error),
        ...(errorCode ? { errorCode } : {}),
      };
    }
  }

  private async resolveRequestedJoin(bookId: number, row: BookDockFileRow, requester: RequestUser | undefined): Promise<ResolvedJoinTarget> {
    if (!this.joinService) throw new Error('Joining an existing book is not available');
    const unitFiles = await this.repo.findUnitFiles(row.id);
    const contentFormats = unitFiles.length
      ? unitFiles.filter((file) => file.role === 'content').map((file) => file.format ?? extname(file.fileName).slice(1))
      : [row.format ?? extname(row.fileName).slice(1)];
    return this.joinService.resolveRequested(
      bookId,
      requester,
      contentFormats.map((format) => format.toLowerCase()),
    );
  }

  /**
   * What the preview says about adding each listed file to an existing book: whether it may, and
   * which book it looks like another format of. One suggestion lookup per batch, not per file.
   */
  private async describeJoins(
    analyses: FinalizeCandidateAnalysis[],
    requester: RequestUser | undefined,
    access: Map<number, Promise<boolean>>,
  ): Promise<Map<number, PreviewJoinInfo>> {
    const info = new Map<number, PreviewJoinInfo>();
    if (!requester || !this.joinService) return info;

    const inputs: JoinSuggestionInput[] = [];
    for (const analysis of analyses) {
      if (!analysis.library) continue;
      const canJoinBook = await this.joinService.canJoinIn(analysis.library, requester, access);
      info.set(analysis.fileId, { canJoinBook });
      if (!canJoinBook || analysis.status !== 'ready' || analysis.joinBook) continue;
      inputs.push({
        fileId: analysis.fileId,
        libraryId: analysis.library.id,
        metadata: normalizeBookDockMetadata(analysis.row.selectedMetadata ?? analysis.row.embeddedMetadata),
        formats: placedContentFormats(analysis),
      });
    }

    for (const [fileId, suggestion] of await this.joinService.suggest(inputs, requester)) {
      const entry = info.get(fileId);
      if (entry) entry.suggestedJoinBook = suggestion;
    }
    return info;
  }

  private async prepareFinalizeBatch(
    rows: BookDockFileRow[],
    defaultLibraryId: number | undefined,
    defaultFolderId: number | undefined,
    overrideMap: Map<number, FinalizeOverrideEntry>,
    userId: number,
    isSuperuser: boolean,
    requester?: RequestUser,
  ): Promise<{ analyses: FinalizeCandidateAnalysis[]; existingDestinations: Map<string, number> }> {
    const analyses: FinalizeCandidateAnalysis[] = [];
    for (const row of rows) {
      analyses.push(await this.resolveFinalizeCandidate(row, defaultLibraryId, defaultFolderId, overrideMap, userId, isSuperuser, requester));
    }

    const destinationPaths = analyses.filter((analysis) => analysis.status === 'ready' && analysis.destPath).map((analysis) => analysis.destPath!);
    const existingRows = await this.repo.findExistingBooksByAbsolutePaths(destinationPaths);
    const existingDestinations = new Map(
      existingRows.map((existing) => [this.destinationKey(existing.libraryId, existing.absolutePath), existing.bookId]),
    );

    return { analyses, existingDestinations };
  }

  /**
   * The book to join, when joining one is possible: the library keeps one book per folder, and the
   * book has a folder of its own inside the one being filed into (see `hasFolderOfItsOwn`).
   */
  private resolveJoinBook(joinBook: FinalizeOverrideEntry['joinBook'], library: LibraryRow, folder: LibraryFolderRow): JoinBook | null {
    if (!joinBook || library.organizationMode !== 'book_per_folder') return null;
    return hasFolderOfItsOwn(joinBook, folder.path) ? joinBook : null;
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
        bookFolderPath: resolveSingleFileBookPath(destPath, folderPath, library.organizationMode),
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

    // Shared folders have no exclusive owner, but disc paths must still survive placement.
    let root = row.unitDirectory ?? dirname(row.absolutePath);
    if (!row.unitDirectory) {
      for (const member of unitFiles) {
        while (!member.absolutePath.startsWith(root + sep) && dirname(root) !== root) root = dirname(root);
      }
    }
    const destinationFolder = unitDestinationFolder(destPath, folderPath);
    return {
      files: ordered.map((file) => ({
        sourcePath: file.absolutePath,
        // The path *within* the unit, not the bare file name: a two-disc audiobook holds two files
        // called `track01.mp3`, and flattening them makes the second overwrite the first.
        destPath: join(destinationFolder, this.unitRelativeName(root, file)),
        format: file.format,
        role: (file.role as FileRole) ?? 'content',
        sortOrder: file.sortOrder,
      })),
      bookFolderPath: destinationFolder,
    };
  }

  /** Each segment sanitized on its own, so the subdirectory survives rather than the separator. */
  private unitRelativeName(root: string, file: BookDockUnitFileRow): string {
    const within = relative(root, file.absolutePath);
    if (!within || within.startsWith('..') || isAbsolute(within)) return this.validator.sanitizeFilename(file.fileName);
    return within
      .split(sep)
      .map((segment) => this.validator.sanitizeFilename(segment))
      .join(sep);
  }

  /**
   * The audiobook player derives progress from each audio file's own duration, and nothing else
   * measures a filed file before the library's next scan; without one, listening stays at 0%.
   * Never throws: the book is already filed, and a scan repairs whatever this could not measure.
   */
  private async measureAudioDurations(bookIds: number[], fileId: number): Promise<void> {
    for (const bookId of bookIds) {
      const startedAt = Date.now();
      try {
        const { measured, failed } = await this.metadataService.measureMissingAudioDurations(bookId);
        if (failed > 0) {
          this.logger.warn(
            `[book_dock.measure_audio_durations] [end] fileId=${fileId} bookId=${bookId} durationMs=${Date.now() - startedAt} measured=${measured} failed=${failed} - some audio durations could not be measured`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[book_dock.measure_audio_durations] [fail] fileId=${fileId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - audio duration measurement failed`,
        );
      }
    }
  }

  /** Undoes a part-placed unit. Never throws: it runs while another error is on its way up. */
  private async undoPlacement(undo: Array<() => Promise<unknown>>): Promise<void> {
    for (const step of undo) {
      await step().catch(() => {});
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
    const sharedFolderPath = bookFolderPath === placement[0]!.destPath ? persistedPrimaryPath : (bookFolderPath ?? dirname(persistedPrimaryPath));
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
      this.logFinalizeFailure(analysis.fileId, 'destination_check', error);
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

  private logFinalizeFailure(fileId: number, stage: string, error: unknown): void {
    const details = finalizeErrorLogDetails(error);
    this.logger.warn(
      `[book_dock.finalize] [fail] fileId=${fileId} stage=${stage} errorClass=${details.errorClass} errorCode=${details.errorCode} error="${sanitizeLogValue(details.message)}" - Book Dock file finalization failed`,
    );
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
      ...(analysis.errorCode ? { errorCode: analysis.errorCode } : {}),
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
    readyToFile: boolean | undefined,
    filter: BookDockFilter | undefined,
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
          readyToFile,
          filter,
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
    await this.evaluateAutoFile(fileId, true);
  }

  private async reviewHold(fileId: number): Promise<void> {
    if (await this.processingState.isPaused()) {
      this.holdReviewQueue.pause();
      return;
    }
    await this.evaluateAutoFile(fileId, false);
  }

  /**
   * Works out again why each file waits, after an edit changed what it would be filed as or where.
   * Never files anything: a file someone is working on does not leave the dock under them.
   */
  reviewHolds(fileIds: number[]): void {
    if (this.processingState.getCachedPaused()) this.holdReviewQueue.pause();
    for (const fileId of fileIds) this.holdReviewQueue.enqueue(fileId);
  }

  /**
   * Whether a ready file can file itself under its dock's settings (D15). When it cannot, the reason
   * is recorded on the row (D31); when it can and `fileIfClear`, it is filed. A row another module
   * owns is left alone: that module runs its own checks before filing it, and racing it would file
   * the wrong book or file it too soon.
   */
  private async evaluateAutoFile(fileId: number, fileIfClear: boolean): Promise<void> {
    const row = await this.repo.findById(fileId);
    if (!row || row.status !== 'ready' || row.autoFinalizeSuppressed) return;

    const global = await this.appSettings.getBookDockSettings();
    const dock = row.dockId == null ? undefined : await this.dockRegistry.findById(row.dockId);
    const settings = resolveDockSettings(dock ?? null, global);
    // Only Unsorted falls back to the global destination, and only when auto-file would use it.
    const fallback =
      row.dockId == null && settings.autoFinalizeEnabled
        ? { libraryId: global.autoFinalizeLibraryId, folderId: global.autoFinalizeFolderId }
        : NO_DEFAULT_DESTINATION;

    const decision = await this.decideAutoFile(row, settings, fallback);
    const newlyHeld = await this.recordHold(row, decision.kind === 'wait' ? decision.hold : null);
    // The digest reports what auto-file did, so a hold counts only where auto-file looked (D32).
    if (newlyHeld && fileIfClear && settings.autoFinalizeEnabled) this.digest.recordHeld(row);
    if (decision.kind !== 'file' || !fileIfClear) return;

    const startedAt = Date.now();
    const result = await this.finalizePreparedCandidate(decision.analysis, decision.existingDestinations);
    if (result.success) {
      this.logger.log(
        `[book_dock.auto_file] [end] fileId=${fileId} dockId=${row.dockId ?? 'none'} bookId=${result.bookId} joined=${decision.join !== null} confidence=${row.confidence ?? 'none'} durationMs=${Date.now() - startedAt} - Book Dock file filed itself`,
      );
      this.emitChange();
      this.digest.recordFiled(row, result.bookId);
      return;
    }
    this.digest.recordHeld(row);

    // A book that could not take this file as another format is still the same book.
    if (decision.join) {
      const fresh = await this.repo.findById(fileId);
      if (fresh) await this.recordHold(fresh, this.duplicateHold(decision.join, decision.analysis.library!));
    }
    this.logger.warn(
      `[book_dock.auto_file] [fail] fileId=${fileId} dockId=${row.dockId ?? 'none'} durationMs=${Date.now() - startedAt} errorClass=FinalizeFailed error="${sanitizeLogValue(result.message ?? 'unknown')}" - Book Dock file could not file itself`,
    );
  }

  /**
   * The checks, in the order a person would want the reason: where it goes, whether the library takes
   * it, whether the library already holds it, whether auto-file may act (confidence, uploader), and
   * whether its path is free. Steps that only matter to auto-file are skipped when it is off, so a
   * file waiting for a person still says what would stop "File" from working.
   */
  private async decideAutoFile(
    row: BookDockFileRow,
    settings: BookDockEffectiveSettings,
    fallback: { libraryId: number | null; folderId: number | null },
  ): Promise<AutoFileDecision> {
    const autoFile = settings.autoFinalizeEnabled;
    const destination = resolveAutoFinalizeDestination(row, fallback);
    if (!destination) {
      if (row.targetLibraryId !== null) return this.wait('no_folder', await this.libraryDetail(row.targetLibraryId));
      return autoFile ? this.wait('no_destination', null) : { kind: 'wait', hold: null };
    }

    const { metadata, lookedUpCoverUrl } = separateLookedUpCover(
      resolveAutoFinalizeMetadata(settings.autoFinalizeMetadataMode, row.embeddedMetadata, row.fetchedMetadata, row.selectedMetadata),
      row.selectedMetadata,
    );
    const candidate = metadata ? { ...row, selectedMetadata: metadata } : row;
    const baseOverride: FinalizeOverrideEntry = lookedUpCoverUrl ? { lookedUpCoverUrl } : {};
    // Prepared as the system: whether the uploader may add it is its own check below, with its own reason.
    const prepare = (override: FinalizeOverrideEntry) =>
      this.prepareFinalizeBatch([candidate], destination.libraryId, destination.folderId, new Map([[row.id, override]]), 0, true);

    let prepared = await prepare(baseOverride);
    let analysis = prepared.analyses[0];
    if (!analysis) return { kind: 'wait', hold: null };
    if (analysis.status !== 'ready' || !analysis.library) {
      const reason = HOLD_FOR_PREVIEW_STATUS[analysis.status];
      return { kind: 'wait', hold: reason ? { reason, detail: await this.libraryDetail(destination.libraryId) } : null };
    }
    const library = analysis.library;
    const libraryDetail = { libraryId: library.id, libraryName: library.name };

    // Only a match in the library it is headed for holds the file (D29); "Keep both" waives it.
    const keepBoth = row.holdDetail?.keepBoth === true;
    let join: DuplicateMatch | null = null;
    if (!keepBoth) {
      const matches = await this.duplicates.findMatches([{ fileId: row.id, metadata, formats: placedContentFormats(analysis) }], [library.id]);
      const match = matches.get(row.id)?.[0];
      if (match) {
        // Auto-join (D30) needs an identifier: a title and author alone also match an abridged
        // edition or a translation.
        const joinable =
          autoFile &&
          settings.autoJoin &&
          IDENTIFIER_MATCH_REASONS.has(match.reason) &&
          match.canTakeFormat &&
          library.organizationMode === 'book_per_folder';
        if (!joinable) return { kind: 'wait', hold: this.duplicateHold(match, library) };
        join = match;
      }
    }

    if (autoFile) {
      if (!shouldAutoFinalize(row, settings.autoFinalizeMetadataMode, settings.autoFinalizeThreshold)) {
        return this.wait('low_confidence', {
          ...(row.confidence !== null ? { confidence: row.confidence } : {}),
          threshold: settings.autoFinalizeThreshold,
        });
      }
      const uploader = await this.uploaderAllowedToFile(row, library.id);
      if (uploader === false) return this.wait('waiting_for_manager', libraryDetail);
      if (join && uploader && !(await this.joinService?.canJoinIn(library, uploader, new Map()))) {
        return { kind: 'wait', hold: this.duplicateHold(join, library) };
      }
    }

    if (join) {
      prepared = await prepare({
        ...baseOverride,
        folderId: join.libraryFolderId,
        joinBook: { bookId: join.bookId, folderPath: join.folderPath, storedAsFile: join.storedAsFile },
      });
      analysis = prepared.analyses[0];
      if (!analysis || analysis.status !== 'ready' || !analysis.joinBook) return { kind: 'wait', hold: this.duplicateHold(join, library) };
    }

    const classified = await this.classifyDestination(analysis, prepared.existingDestinations);
    if (classified.status === 'duplicate') {
      // The same path already belongs to a book. "Keep both" cannot put a second file there.
      if (keepBoth) return this.wait('destination_conflict', libraryDetail);
      return this.wait('duplicate', { ...libraryDetail, ...(classified.existingBookId !== undefined ? { bookId: classified.existingBookId } : {}) });
    }
    if (classified.status === 'destination_conflict') return this.wait('destination_conflict', libraryDetail);
    if (classified.status !== 'ready' || !autoFile) return { kind: 'wait', hold: null };
    return { kind: 'file', analysis, existingDestinations: prepared.existingDestinations, join };
  }

  private wait(reason: BookDockHoldReason, detail: BookDockHoldDetail | null): AutoFileDecision {
    return { kind: 'wait', hold: { reason, detail } };
  }

  private duplicateHold(match: DuplicateMatch, library: Pick<LibraryRow, 'id' | 'name'>): AutoFileHold {
    return { reason: 'duplicate', detail: { libraryId: library.id, libraryName: library.name, bookId: match.bookId } };
  }

  private async libraryDetail(libraryId: number): Promise<BookDockHoldDetail> {
    const name = (await this.repo.findLibraryNames([libraryId])).get(libraryId);
    return name === undefined ? { libraryId } : { libraryId, libraryName: name };
  }

  /**
   * Who a file is filed for (D24). A file dropped on disk has no uploader and files as the system
   * (null). An upload files only while its uploader is active, may upload books, and can see the
   * library; otherwise `false`, and a dock manager files it.
   */
  private async uploaderAllowedToFile(row: BookDockFileRow, libraryId: number): Promise<RequestUser | null | false> {
    if (row.uploadedBy == null) return null;
    const uploader = await this.users.findByIdWithPermissions(row.uploadedBy);
    if (!uploader?.active) return false;
    if (!uploader.isSuperuser && !uploader.permissions.includes(Permission.LibraryUpload)) return false;
    try {
      await this.libraryService.verifyAccess(uploader, libraryId);
      return uploader;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  /** Writes only on a change. A "Keep both" survives every reason, until the destination changes. */
  /** Writes the reason only when it changed. True when a file that was not waiting now is. */
  private async recordHold(row: BookDockFileRow, hold: AutoFileHold | null): Promise<boolean> {
    const keepBoth = row.holdDetail?.keepBoth === true;
    const reason = hold?.reason ?? null;
    const merged: BookDockHoldDetail = { ...(hold?.detail ?? {}), ...(keepBoth ? { keepBoth: true } : {}) };
    const detail = Object.keys(merged).length > 0 ? merged : null;
    if ((row.holdReason ?? null) === reason && sameHoldDetail(row.holdDetail ?? null, detail)) return false;
    await this.repo.update(row.id, { holdReason: reason, holdDetail: detail });
    this.emitChange();
    return (row.holdReason ?? null) === null && reason !== null;
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
  async finalizeManagedFile(
    fileId: number,
    override: { libraryId?: number; folderId?: number; joinBook?: JoinBook },
  ): Promise<BookDockFinalizeFileResult> {
    const row = await this.repo.findById(fileId);
    if (!row) {
      return { fileId, fileName: `book-dock-file-${fileId}`, success: false, message: 'Library Dock file not found' };
    }

    const { metadata: merged, lookedUpCoverUrl } = separateLookedUpCover(
      mergeBookDockMetadata(row.embeddedMetadata, row.fetchedMetadata, row.selectedMetadata),
      row.selectedMetadata,
    );
    const rowForFinalize = merged ? { ...row, selectedMetadata: merged } : row;

    const overrideMap = new Map<number, FinalizeOverrideEntry>([
      [fileId, { libraryId: override.libraryId, folderId: override.folderId, joinBook: override.joinBook, lookedUpCoverUrl }],
    ]);

    const result = await this.finalizeFile(rowForFinalize, undefined, undefined, overrideMap, 0, true);
    if (result.success) this.emitChange();
    return result;
  }

  /** Checks a file for auto-file, and files it when it may. Also how "Keep both" files a duplicate. */
  enqueueAutoFinalize(fileId: number): void {
    if (this.processingState.getCachedPaused()) this.autoFinalizeQueue.pause();
    this.autoFinalizeQueue.enqueue(fileId);
  }

  pauseProcessing(): void {
    this.autoFinalizeQueue.pause();
    this.holdReviewQueue.pause();
  }

  async resumeProcessing(): Promise<void> {
    if (await this.processingState.isPaused()) return;
    this.autoFinalizeQueue.resume();
    this.holdReviewQueue.resume();
  }

  /** On resume: every ready file, when any dock files by itself. Nothing to do when none does. */
  async requeueAutoFinalizeCandidates(): Promise<number> {
    if (await this.processingState.isPaused()) return 0;
    const global = await this.appSettings.getBookDockSettings();
    const docks = await this.dockRegistry.all();
    if (!global.autoFinalizeEnabled && !docks.some((dock) => dock.autoFinalizeEnabled === true)) return 0;
    return this.requeueReadyFiles(undefined);
  }

  /**
   * After the dock settings change, every ready file they reach is checked again: a lower threshold
   * files what it held, and auto-file turned off drops the reasons only it gave. `dockId` names one
   * dock; without it, the global settings changed and every file is checked. Runs in the
   * background and queues while paused, so a resume runs it.
   */
  recheckAfterSettingsChange(dockId?: number): void {
    const startedAt = Date.now();
    const scope = dockId ?? 'all';
    this.requeueReadyFiles(dockId).then(
      (queued) =>
        this.logger.log(
          `[book_dock.settings_recheck] [end] dockId=${scope} queued=${queued} durationMs=${Date.now() - startedAt} - ready files queued for another auto-file check`,
        ),
      (error: unknown) =>
        this.logger.warn(
          `[book_dock.settings_recheck] [fail] dockId=${scope} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - ready files could not be queued for another auto-file check`,
        ),
    );
  }

  private async requeueReadyFiles(dockId: number | undefined): Promise<number> {
    let queued = 0;
    let afterId: number | undefined;
    while (true) {
      const rows = await this.repo.findSelectionBatch({
        limit: BATCH_SIZE,
        afterId,
        status: 'ready',
        userId: 0,
        canManageAll: true,
        ...(dockId !== undefined ? { dockId } : {}),
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.autoFinalizeSuppressed) continue;
        if (this.processingState.getCachedPaused()) this.autoFinalizeQueue.pause();
        if (this.autoFinalizeQueue.enqueue(row.id)) queued++;
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
    readyToFile?: boolean,
    filter?: BookDockFilter,
  ): Promise<{ fileId: number; fileName: string; newName: string }[]> {
    const ids = selectAll
      ? await this.repo.findAllIds(excludedIds, status, search, userId, canManageAll, needsReview, readyToFile, filter)
      : (fileIds ?? []);
    if (!ids.length) return [];

    const rows = await this.repo.findByIds(ids, userId, canManageAll);
    const appPatternFile = await this.appSettings.getUploadPattern();
    const appPatternFolder = await this.appSettings.getUploadPatternBookPerFolder();
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const libraryIds = [...new Set(rows.map((row) => row.targetLibraryId ?? defaultLibraryId).filter((id): id is number => id != null))];
    const libraryMap = libraryIds.length
      ? new Map((await this.db.select().from(libraries).where(inArray(libraries.id, libraryIds))).map((lib) => [lib.id, lib]))
      : new Map<number, typeof libraries.$inferSelect>();

    return Promise.all(
      rows.map(async (row) => {
        const format = row.format ?? extname(row.fileName).toLowerCase().slice(1);
        const effectiveLibraryId = row.targetLibraryId ?? defaultLibraryId ?? null;
        const lib = effectiveLibraryId !== null ? libraryMap.get(effectiveLibraryId) : undefined;
        const pattern = lib?.fileNamingPattern ?? (lib?.organizationMode === 'book_per_folder' ? appPatternFolder : appPatternFile);
        const newName = await this.resolveRelativeDestination(lib, row, format, pattern, sanitizeForCrossPlatform);

        return { fileId: row.id, fileName: row.fileName, newName };
      }),
    );
  }

  private async resolveDestination(library: NamingLibrary, folderPath: string, row: BookDockFileRow, format: string): Promise<string> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();

    return join(folderPath, await this.resolveRelativeDestination(library, row, format, pattern, sanitizeForCrossPlatform));
  }

  /**
   * Where a docked file belongs under its library folder. The finalize move and the name
   * preview both go through here so they cannot disagree about the destination.
   *
   * Both organization modes keep the pattern's folder segments, matching the rename and move
   * services; `book_per_file` differs only in that the file itself is the book, so without a
   * pattern it stays where it is instead of gaining a folder of its own.
   */
  private async resolveRelativeDestination(
    library: NamingLibrary | undefined,
    row: BookDockFileRow,
    format: string,
    pattern: string | null,
    sanitizeForCrossPlatform: boolean,
  ): Promise<string> {
    if (pattern) {
      const meta = row.selectedMetadata ?? row.embeddedMetadata ?? {};
      const mediaOverlayAvailable = patternReferencesToken(pattern, 'readaloud')
        ? await this.inspectMediaOverlayAvailable(row.absolutePath, format)
        : false;
      const tokens = this.buildFilePatternTokens(meta, row.fileName, format, library?.name, mediaOverlayAvailable);
      const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });
      if (resolved) return resolved;
    }

    if (library?.organizationMode === 'book_per_folder') {
      return join(basename(row.fileName, extname(row.fileName)), row.fileName);
    }

    return row.fileName;
  }

  private buildFilePatternTokens(
    meta: BookDockMetadata,
    fileName: string,
    format: string,
    libraryName?: string | null,
    mediaOverlayAvailable = false,
  ): Record<string, string> {
    return buildPatternTokens({
      metadata: {
        ...meta,
        originalPublishedYear: normalizePublishedYear(meta.originalPublishedYear),
        seriesMemberships: finalizeSeriesMemberships(meta.seriesMemberships, meta.seriesName ?? null, meta.seriesIndex ?? null),
      },
      authors: meta.authors,
      narrators: meta.narrators,
      originalStem: basename(fileName, extname(fileName)),
      format,
      libraryName,
      mediaOverlayAvailable,
    });
  }

  private async inspectMediaOverlayAvailable(absolutePath: string, format: string): Promise<boolean> {
    const startedAt = Date.now();
    const fields = await inspectEpubMediaOverlayFields(absolutePath, format, (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[book_dock.media_overlay_capability] [fail] path="${sanitizeLogValue(absolutePath)}" durationMs=${Date.now() - startedAt} errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - EPUB media-overlay inspection failed`,
      );
    });
    return fields.mediaOverlayAvailable;
  }

  /**
   * What a new format adds to a book that already exists: its own cover slot while that is empty,
   * and the audio facts and identifiers the book does not have yet, unless they are locked. Nothing
   * the book already says is overwritten - the title, authors and description were settled before
   * this file arrived, and an audiobook's tags routinely disagree with them ("Unabridged", the
   * narrator as author).
   */
  private async applyJoinedMetadata(
    bookId: number,
    row: BookDockFileRow,
    requestedCoverUrl: string | null,
    lookedUpCoverUrl: string | null,
  ): Promise<void> {
    const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata);
    const audio = resolveAudioFinalizeFields(row.embeddedMetadata, row.selectedMetadata);
    const medium = row.format && isAudioFormat(row.format) ? 'audio' : 'ebook';

    // A cover picked in the Book Dock for this file is used as it is. Otherwise only an empty slot is
    // filled: a cover the book already holds for this medium stays, a custom one resting dormant
    // since the last copy of this format went away included. The requested art comes last.
    const picked = meta.coverUrl
      ? await this.metadataService.downloadAndSaveCover([{ url: meta.coverUrl }], bookId, medium, { userChosen: true })
      : false;
    if (!picked && (await this.metadataService.coverSlotIsEmpty(bookId, medium))) {
      await this.applyUnpickedCover(bookId, row, medium, true, lookedUpCoverUrl, requestedCoverUrl);
    }

    const [current] = await this.db
      .select({
        lockedFields: bookMetadata.lockedFields,
        durationSeconds: bookMetadata.durationSeconds,
        abridged: bookMetadata.abridged,
        chapters: bookMetadata.chapters,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    const locked = new Set(current?.lockedFields ?? []);

    const identifiers = {
      googleBooksId: meta.googleBooksId,
      goodreadsId: meta.goodreadsId,
      amazonId: meta.amazonId,
      hardcoverId: meta.hardcoverId,
      openLibraryId: meta.openLibraryId,
      itunesId: meta.itunesId,
      audibleId: meta.audibleId,
      librofmId: meta.librofmId,
      koboId: meta.koboId,
    } as const;
    const fillMissing: Record<string, SQL> = {};
    for (const [field, value] of Object.entries(identifiers)) {
      if (value && !locked.has(field)) fillMissing[field] = sql`coalesce(${bookMetadata[field as keyof typeof identifiers]}, ${value})`;
    }

    const audioPatch = medium === 'audio' ? buildAudioMetadataPatch(audio) : {};
    const audioFill = {
      ...(audioPatch.durationSeconds !== undefined && current?.durationSeconds == null && !locked.has('durationSeconds')
        ? { durationSeconds: audioPatch.durationSeconds }
        : {}),
      ...(audioPatch.abridged !== undefined && current?.abridged == null && !locked.has('abridged') ? { abridged: audioPatch.abridged } : {}),
      ...(audioPatch.chapters !== undefined && !(Array.isArray(current?.chapters) && current.chapters.length > 0)
        ? { chapters: audioPatch.chapters }
        : {}),
    };
    if (Object.keys(fillMissing).length > 0 || Object.keys(audioFill).length > 0) {
      await this.db
        .update(bookMetadata)
        .set({ ...fillMissing, ...audioFill, updatedAt: new Date() })
        .where(eq(bookMetadata.bookId, bookId));
    }

    if (medium === 'audio' && audio.narrators.length > 0 && !locked.has('narrators') && !(await this.hasNarrators(bookId))) {
      await this.metadataService.replaceNarrators(
        bookId,
        audio.narrators.map((name) => ({ name, sortName: null })),
      );
    }

    await this.metadataScoreService.calculateAndSave(bookId);
  }

  private async hasNarrators(bookId: number): Promise<boolean> {
    const [row] = await this.db.select({ bookId: bookNarrators.bookId }).from(bookNarrators).where(eq(bookNarrators.bookId, bookId)).limit(1);
    return row !== undefined;
  }

  /**
   * One cover slot for a file nobody picked a cover for, filled the way a metadata refresh fills it.
   * The file's own art goes in first. The cover the field rules chose in the metadata lookup then
   * replaces it only if it fits the slot, so the rules decide between providers while a portrait
   * jacket can never displace the square art an m4b carries. `fallbackUrl` is tried only while the
   * slot is still empty.
   */
  private async applyUnpickedCover(
    bookId: number,
    row: BookDockFileRow,
    medium: CoverMedium,
    ownsStagedCover: boolean,
    lookedUpCoverUrl: string | null,
    fallbackUrl: string | null,
  ): Promise<void> {
    let staged = false;
    if (ownsStagedCover && row.coverPath) {
      try {
        await this.metadataService.saveExtractedCoverBytes(bookId, await readFile(row.coverPath), medium);
        staged = true;
      } catch (err) {
        this.logger.warn(`Failed to copy Book Dock cover to book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const urls = [lookedUpCoverUrl, staged ? null : fallbackUrl].filter((url, index, all): url is string => !!url && all.indexOf(url) === index);
    if (urls.length > 0)
      await this.metadataService.downloadAndSaveCover(
        urls.map((url) => ({ url })),
        bookId,
        medium,
      );
  }

  /**
   * `lookedUpCoverUrl`: see `applyUnpickedCover`. A cover picked in the Book Dock is used as it is.
   * The staged cover was read from the unit's primary file, so it fills only that file's medium on
   * the book that owns it (`ownsStagedCover`); the other books of a loose-file unit get their own
   * art from reconcile.
   */
  private async applyMetadata(bookId: number, row: BookDockFileRow, ownsStagedCover = true, lookedUpCoverUrl: string | null = null): Promise<void> {
    const meta = normalizeFinalizeMetadata(row.selectedMetadata ?? row.embeddedMetadata);
    const audio = resolveAudioFinalizeFields(row.embeddedMetadata, row.selectedMetadata);

    const medium = row.format && isAudioFormat(row.format) ? 'audio' : 'ebook';
    const picked = meta.coverUrl
      ? await this.metadataService.downloadAndSaveCover([{ url: meta.coverUrl }], bookId, medium, { userChosen: true })
      : false;
    if (!picked) await this.applyUnpickedCover(bookId, row, medium, ownsStagedCover, lookedUpCoverUrl, null);

    const scalarFields = {
      title: meta.title ?? null,
      subtitle: meta.subtitle ?? null,
      description: meta.description ?? null,
      isbn10: meta.isbn10 ?? null,
      isbn13: meta.isbn13 ?? null,
      publisher: meta.publisher ?? null,
      publishedDate: meta.publishedDate ?? null,
      publishedYear: meta.publishedYear ?? null,
      originalPublishedYear: meta.originalPublishedYear ?? undefined,
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

    if (meta.externalProviderIds) await this.providerIdStore?.write(bookId, meta.externalProviderIds);
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

    if (meta.tags.length > 0) {
      await this.metadataService.replaceTags(bookId, meta.tags);
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

  /**
   * Discarding a unit throws away every file in it. Discarding track 1 of 31 is not a thing. In a
   * keep-original dock nothing is deleted: the files are remembered and skipped from then on (D35).
   */
  private async cleanupDiscardedBookDockFile(row: BookDockFileRow, keepOriginal: boolean): Promise<void> {
    if (keepOriginal) {
      await this.keptFiles.remember(row, { discarded: true });
    } else {
      for (const file of await this.repo.findUnitFiles(row.id)) await safeUnlink(file.absolutePath);
      if (row.unitDirectory) {
        await removeEmptyDirectory(row.unitDirectory);
      }
      await safeUnlink(row.absolutePath);
    }
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
    joining: 0,
    duplicates: 0,
    destinationConflicts: 0,
    missingDestination: 0,
    blocked: 0,
    truncated: false,
    itemLimit: PREVIEW_ITEM_LIMIT,
    items: [],
  };
}

function addFinalizePreviewAnalysis(summary: BookDockFinalizePreviewResult, analysis: FinalizeCandidateAnalysis, join?: PreviewJoinInfo): void {
  addFinalizePreviewItem(summary, {
    fileId: analysis.fileId,
    fileName: analysis.fileName,
    newName: analysis.newName,
    status: analysis.status,
    existingBookId: analysis.existingBookId,
    message: analysis.message,
    ...(analysis.errorCode ? { errorCode: analysis.errorCode } : {}),
    ...(analysis.library ? { libraryId: analysis.library.id } : {}),
    ...(join ? { canJoinBook: join.canJoinBook } : {}),
    ...(analysis.joinSummary && analysis.status === 'ready' ? { joinsBook: analysis.joinSummary } : {}),
    ...(join?.suggestedJoinBook ? { suggestedJoinBook: join.suggestedJoinBook } : {}),
  });
}

function addFinalizePreviewItem(summary: BookDockFinalizePreviewResult, item: BookDockFinalizePreviewItem): void {
  summary.total++;
  if (item.status === 'ready' && item.joinsBook) summary.joining = (summary.joining ?? 0) + 1;
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
  const seriesName = normalizeText(normalizedMeta?.seriesName, 500);
  const seriesIndex = parseSeriesIndex(normalizedMeta?.seriesIndex);
  return {
    title: normalizeText(normalizedMeta?.title, 1000),
    subtitle: normalizeText(normalizedMeta?.subtitle, 1000),
    description: normalizeText(normalizedMeta?.description),
    isbn10: normalizeIsbn(normalizedMeta?.isbn10, 10),
    isbn13: normalizeIsbn(normalizedMeta?.isbn13, 13),
    publisher: normalizeText(normalizedMeta?.publisher, 500),
    publishedDate,
    publishedYear: publishedDate ? publishedYearFromDateKey(publishedDate) : normalizePublishedYear(normalizedMeta?.publishedYear),
    originalPublishedYear: normalizePublishedYear(normalizedMeta?.originalPublishedYear),
    language: normalizeLanguage(normalizedMeta?.language),
    pageCount: normalizeInteger(normalizedMeta?.pageCount),
    seriesName,
    seriesIndex,
    authors: normalizeStringArray(normalizedMeta?.authors, 500),
    genres: normalizeStringArray(normalizedMeta?.genres, 200),
    tags: normalizeStringArray(normalizedMeta?.tags, 200),
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
    seriesMemberships: finalizeSeriesMemberships(normalizedMeta?.seriesMemberships, seriesName, seriesIndex),
    communityRatings: normalizeCommunityRatings(normalizedMeta?.communityRatings),
    externalProviderIds: normalizedMeta?.externalProviderIds ?? undefined,
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

/**
 * A provider match stores its whole series list, but the Book Dock form edits only the first entry as
 * the series name and number. The form's values replace that entry, so a corrected series is filed
 * instead of the provider's spelling.
 */
function finalizeSeriesMemberships(
  value: BookDockMetadata['seriesMemberships'],
  seriesName: string | null,
  seriesIndex: string | null,
): MetadataSeriesMembership[] | undefined {
  const memberships = normalizeSeriesMemberships(value);
  if (memberships === undefined || !seriesName) return memberships;
  const key = seriesName.toLowerCase();
  const others = memberships.slice(1).filter((membership) => membership.seriesName.toLowerCase() !== key);
  return [{ seriesName, seriesIndex }, ...others];
}

function normalizeCommunityRatings(
  value: BookDockMetadata['communityRatings'],
): Array<{ provider: MetadataProviderKey; rating: number; ratingCount: number | null }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];

  const ratings = new Map<MetadataProviderKey, { provider: MetadataProviderKey; rating: number; ratingCount: number | null }>();
  for (const item of value) {
    if (!item || !isMetadataProviderKeySyntax(item.provider)) continue;
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
  chaptersSource: AudiobookChapterSource;
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
    chaptersSource: normalizedSelected?.chapters !== undefined ? 'provider' : 'embedded',
    narrators: normalizeStringArray(normalizedSelected?.narrators !== undefined ? normalizedSelected.narrators : normalizedEmbedded?.narrators, 500),
    abridged: normalizeAbridged(normalizedSelected?.abridged !== undefined ? normalizedSelected.abridged : normalizedEmbedded?.abridged),
  };
}

function buildAudioMetadataPatch(
  audio: AudioFinalizeFields,
): { durationSeconds?: number; chapters?: AudiobookChapter[]; abridged?: boolean } & Partial<ReturnType<typeof chapterProvenance>> {
  const patch: { durationSeconds?: number; chapters?: AudiobookChapter[]; abridged?: boolean } & Partial<ReturnType<typeof chapterProvenance>> = {};
  if (audio.durationSeconds !== null) patch.durationSeconds = audio.durationSeconds;
  if (audio.chapters !== null) Object.assign(patch, { chapters: audio.chapters }, chapterProvenance(audio.chapters, audio.chaptersSource));
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
  return chapters.length > 0 ? normalizeAudiobookChapters(chapters) : null;
}

function resolveFinalizeErrorMessage(error: unknown): string {
  if (isPublishedYearConstraintViolation(error)) {
    return INVALID_PUBLISHED_YEAR_MESSAGE;
  }
  if (isBookMetadataConstraintViolation(error)) {
    return INVALID_METADATA_MESSAGE;
  }
  // Infrastructure errors can contain SQL and absolute filesystem paths. They belong in the
  // sanitized server log, not in the request drawer of the person who asked for the book.
  if (isDatabaseError(error) || hasNodeStyleErrorCode(error)) {
    return INTERNAL_FAILURE_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Finalization failed';
}

/**
 * Drizzle wraps the driver's `DatabaseError` in a `DrizzleQueryError`, so the chain is walked
 * rather than relying on the outermost error. Checking the concrete error type avoids mistaking
 * five-character Node codes such as `EPERM` and `EXDEV` for SQLSTATE values.
 */
function isDatabaseError(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry instanceof DatabaseError) return true;
  }
  return false;
}

function hasNodeStyleErrorCode(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (/^E[A-Z0-9_]+$/.test(asString(entry.code))) return true;
  }
  return false;
}

function finalizeErrorLogDetails(error: unknown): { errorClass: string; errorCode: string; message: string } {
  let selected: Record<string, unknown> | undefined;
  for (const entry of iterateErrorChain(error)) selected = entry;

  const errorCode = asString(selected?.code) || 'none';
  const errorClass =
    selected instanceof Error ? selected.constructor.name : asString(selected?.name) || (error instanceof Error ? error.constructor.name : 'Error');
  const message = hasNodeStyleErrorCode(error) ? errorCode : asString(selected?.message) || (error instanceof Error ? error.message : String(error));

  return { errorClass, errorCode, message };
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

export function mergeBookDockMetadata(
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

/**
 * Splits off a cover the merge took from the metadata lookup. A cover in the row's own selection
 * was picked by a person and stays; anything else the merge carried was found unattended.
 */
function separateLookedUpCover(
  metadata: BookDockMetadata | null,
  selected: BookDockMetadata | null | undefined,
): { metadata: BookDockMetadata | null; lookedUpCoverUrl: string | null } {
  const picked = normalizeBookDockMetadata(selected)?.coverUrl ?? null;
  if (!metadata?.coverUrl || metadata.coverUrl === picked) return { metadata, lookedUpCoverUrl: null };
  const { coverUrl, ...rest } = metadata;
  return { metadata: Object.keys(rest).length > 0 ? rest : null, lookedUpCoverUrl: coverUrl };
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

/**
 * Where auto-finalize files a row: its own destination first, the configured default otherwise.
 * The default folder only stands in for a missing folder when it belongs to the row's library;
 * a folder from another library would fail the placement after the work of preparing it.
 */
function resolveAutoFinalizeDestination(
  row: BookDockFileRow,
  settings: { libraryId: number | null; folderId: number | null },
): { libraryId: number; folderId: number } | null {
  const libraryId = row.targetLibraryId ?? settings.libraryId;
  if (libraryId === null) return null;
  const folderId = row.targetFolderId ?? (libraryId === settings.libraryId ? settings.folderId : null);
  if (folderId === null) return null;
  return { libraryId, folderId };
}

function shouldAutoFinalize(row: BookDockFileRow, mode: BookDockAutoFinalizeMetadataMode, threshold: number): boolean {
  if (mode === 'embedded_only') {
    return row.status === 'ready';
  }
  return row.confidence !== null && row.confidence >= threshold;
}

/** The content formats a prepared file would place, lowercased. */
function placedContentFormats(analysis: FinalizeCandidateAnalysis): string[] {
  return (analysis.placement ?? [])
    .filter((file) => file.role === 'content')
    .map((file) => (file.format ?? extname(file.destPath).slice(1)).toLowerCase());
}

function sameHoldDetail(a: BookDockHoldDetail | null, b: BookDockHoldDetail | null): boolean {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof BookDockHoldDetail>);
  return [...keys].every((key) => a[key] === b[key]);
}

function toOverrideMap(overrides: FinalizeRequestOverride[] | undefined): Map<number, FinalizeOverrideEntry> {
  return new Map(
    (overrides ?? []).map(({ joinBook, ...rest }) => [rest.fileId, joinBook ? { ...rest, requestedJoinBookId: joinBook.bookId } : rest]),
  );
}

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids)];
}
