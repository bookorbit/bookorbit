import { Inject, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { stat } from 'fs/promises';
import { basename } from 'path';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isAudioFormat } from '@bookorbit/types';
import type { FileRole as BookFileRole } from '../scanner/lib/classify';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { selectPrimaryFileKeepingCurrent } from '../../common/utils/primary-file-selection.utils';
import { naturalCompare } from '../../common/utils/natural-sort.utils';
import { FORMATS_WITH_UNBOUNDED_METADATA_READS, MAX_BUFFERED_METADATA_BYTES } from '../../common/constants/upload.constants';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books, libraries, uploadSessions } from '../../db/schema';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { CoverSlotReconciler } from '../metadata/cover-slot-reconciler.service';
import { MetadataService } from '../metadata/metadata.service';
import { METADATA_AUDIO_FORMATS } from '../metadata/metadata-extraction.service';
import { computeFileHash } from '../scanner/lib/hash';
import { inspectEpubMediaOverlayFields } from '../reader/epub/epub-media-overlay-capability';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** One file of a unit, already placed on disk, described the way `book_files` wants it. */
export interface UnitBookFileInput {
  folderPath: string;
  absolutePath: string;
  relPath: string;
  format: string;
  sizeBytes: number;
  role?: BookFileRole;
  sortOrder?: number | null;
}

/**
 * What a unit actually wrote, so a later failure can take it back. `attachedFileIds` are rows
 * added to books that were already there: undoing those must remove the file rows and leave the
 * book alone. `replacedPrimaries` are those books whose primary the new files outranked, because
 * deleting the rows alone would leave such a book with no primary at all.
 */
export interface UnitBookRecords {
  /** Every book the unit touched, primary first. */
  bookIds: number[];
  createdBookIds: number[];
  attachedFileIds: number[];
  replacedPrimaries: ReplacedPrimary[];
}

export interface ReplacedPrimary {
  bookId: number;
  previousPrimaryFileId: number | null;
  primaryFileId: number;
}

/** A book that a file joined, as it stood before any file of this transaction was added. */
interface JoinedBook {
  id: number;
  primaryFileId: number | null;
  status: string;
  formatPriority: string[];
}

interface MeasuredFile {
  ino: bigint;
  mtime: Date;
  fileHash: string;
  mediaOverlayAvailable: boolean;
  mediaOverlayDurationSeconds: number | null;
  mediaOverlayCheckedAt: Date | null;
}

const METADATA_FORMATS = new Set([
  'epub',
  'kepub',
  'mobi',
  'azw3',
  'azw',
  'cbz',
  'cbr',
  'cb7',
  'fb2',
  'pdf',
  'm4b',
  'm4a',
  'mp3',
  'opus',
  'ogg',
  'flac',
]);

@Injectable()
export class UploadProcessorService {
  private readonly logger = new Logger(UploadProcessorService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly metadataService: MetadataService,
    private readonly coverStore: BookCoverStore,
    @Optional() private readonly autoFetchOrchestrator?: BookMetadataFetchOrchestratorService,
    @Optional() private readonly coverReconciler?: CoverSlotReconciler,
  ) {}

  /** A file joined or left these books, so their cover slots are brought back in line with it. */
  reconcileCoversAsync(bookIds: readonly number[]): void {
    if (!this.coverReconciler || bookIds.length === 0) return;
    void this.coverReconciler.enqueue(bookIds, { filesChanged: true });
  }

  private async inspectMediaOverlayFields(absolutePath: string, format: string | null) {
    return inspectEpubMediaOverlayFields(absolutePath, format, (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[upload.processor.media_overlay_capability] [fail] path="${sanitizeLogValue(absolutePath)}" errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - EPUB media-overlay inspection failed`,
      );
    });
  }

  /**
   * One `book_files` row, attached to the book that owns `folderPath` or to a new one. Calling it
   * repeatedly with the same `folderPath` is how a multi-file unit becomes one book with many
   * files, and it is why the caller must pass the **primary file first**: a new book takes its
   * first file as primary. A book that already existed re-ranks its primary instead.
   */
  async createBookRecord(
    libraryId: number,
    libraryFolderId: number,
    folderPath: string,
    absolutePath: string,
    relPath: string,
    format: string,
    sizeBytes: number,
    options: { role?: BookFileRole; sortOrder?: number | null; uploadSessionId?: string } = {},
  ): Promise<{ bookId: number; created: boolean }> {
    const { uploadSessionId, ...fileOptions } = options;
    const measured = await this.measureFile(absolutePath, format);
    const result = await this.db.transaction(async (tx) => {
      const upserted = await this.upsertBookFile(
        tx,
        libraryId,
        libraryFolderId,
        { folderPath, absolutePath, relPath, format, sizeBytes, ...fileOptions },
        measured,
      );
      if (upserted.joinedBook && (fileOptions.role ?? 'content') === 'content') {
        await this.reselectPrimaryFile(tx, upserted.joinedBook);
      }
      if (uploadSessionId) {
        await tx.update(uploadSessions).set({ resultBookId: upserted.bookId, updatedAt: new Date() }).where(eq(uploadSessions.id, uploadSessionId));
      }
      return upserted;
    });
    return { bookId: result.bookId, created: result.createdBook };
  }

  /**
   * Every file of one unit in a single transaction. `createBookRecord` opens its own transaction
   * per call, so filing a 31-track audiobook through it committed 31 times and a failure on track
   * three left the first two behind as a ghost book. Here nothing is visible until all of it is.
   *
   * Files must arrive **primary first**: `primaryFileId` is set on the row that creates the book.
   * A book that already existed re-ranks its primary once every file of the unit is in.
   */
  async createUnitBookRecords(libraryId: number, libraryFolderId: number, files: UnitBookFileInput[]): Promise<UnitBookRecords> {
    if (files.length === 0) throw new InternalServerErrorException('Cannot create a book from an empty unit');

    // Hashing is the expensive half and needs no transaction, so it happens before one is open
    // rather than holding a write transaction for the length of a 31-track read.
    const measured: MeasuredFile[] = [];
    for (const file of files) measured.push(await this.measureFile(file.absolutePath, file.format));

    return this.db.transaction(async (tx) => {
      const bookIds: number[] = [];
      const createdBookIds: number[] = [];
      const attachedFileIds: number[] = [];
      const joinedBooks = new Map<number, JoinedBook>();

      for (const [index, file] of files.entries()) {
        const result = await this.upsertBookFile(tx, libraryId, libraryFolderId, file, measured[index]!);
        if (!bookIds.includes(result.bookId)) bookIds.push(result.bookId);
        if (result.createdBook) createdBookIds.push(result.bookId);
        // A row on a book this unit created goes away with the book, so only rows attached to a
        // book that was already there need remembering - and only the ones actually inserted,
        // never one that was already pointing at that path.
        else if (result.createdFile && !createdBookIds.includes(result.bookId)) attachedFileIds.push(result.fileId);

        // The first sighting is the book as it stood before this unit, which is what a rollback restores.
        const joined = result.joinedBook;
        if (joined && (file.role ?? 'content') === 'content' && !createdBookIds.includes(joined.id) && !joinedBooks.has(joined.id)) {
          joinedBooks.set(joined.id, joined);
        }
      }

      const replacedPrimaries: ReplacedPrimary[] = [];
      for (const joined of joinedBooks.values()) {
        const replaced = await this.reselectPrimaryFile(tx, joined);
        if (replaced) replacedPrimaries.push(replaced);
      }

      return { bookIds, createdBookIds, attachedFileIds, replacedPrimaries };
    });
  }

  /**
   * Takes back exactly what {@link createUnitBookRecords} wrote. Books it created go entirely,
   * taking their files and metadata with them through the cascade; books it only attached to keep
   * everything except the rows this unit added.
   */
  async deleteUnitBookRecords(records: UnitBookRecords): Promise<void> {
    if (records.createdBookIds.length === 0 && records.attachedFileIds.length === 0 && records.replacedPrimaries.length === 0) return;

    await this.db.transaction(async (tx) => {
      if (records.attachedFileIds.length > 0) {
        await tx.delete(bookFiles).where(inArray(bookFiles.id, records.attachedFileIds));
      }
      for (const replaced of records.replacedPrimaries) await this.restorePrimaryFile(tx, replaced);
      if (records.createdBookIds.length > 0) {
        // `books.primary_file_id` is `on delete set null`, so clearing the files first leaves
        // nothing pointing at a row that is about to disappear.
        await tx.delete(bookFiles).where(inArray(bookFiles.bookId, records.createdBookIds));
        await tx.delete(books).where(inArray(books.id, records.createdBookIds));
      }
    });
    // Metadata may already have written covers for the books this unit created.
    await Promise.allSettled(records.createdBookIds.map((bookId) => this.coverStore.removeCoverDirectory(bookId)));
    this.reconcileCoversAsync(records.bookIds.filter((bookId) => !records.createdBookIds.includes(bookId)));
  }

  private async measureFile(absolutePath: string, format: string): Promise<MeasuredFile> {
    const [fileStat, fileHash, mediaOverlayFields] = await Promise.all([
      stat(absolutePath, { bigint: true }),
      computeFileHash(absolutePath),
      this.inspectMediaOverlayFields(absolutePath, format),
    ]);
    return { ino: fileStat.ino, mtime: fileStat.mtime, fileHash, ...mediaOverlayFields };
  }

  private async upsertBookFile(
    tx: Tx,
    libraryId: number,
    libraryFolderId: number,
    file: UnitBookFileInput,
    measured: MeasuredFile,
  ): Promise<{ bookId: number; createdBook: boolean; fileId: number; createdFile: boolean; joinedBook: JoinedBook | null }> {
    const { folderPath, absolutePath, relPath, format, sizeBytes } = file;
    const role = file.role ?? 'content';
    const sortOrder = file.sortOrder ?? null;
    const values = {
      libraryFolderId,
      absolutePath,
      relPath,
      ino: measured.ino,
      sizeBytes,
      mtime: measured.mtime,
      fileHash: measured.fileHash,
      format,
      role,
      sortOrder,
      mediaOverlayAvailable: measured.mediaOverlayAvailable,
      mediaOverlayDurationSeconds: measured.mediaOverlayDurationSeconds,
      mediaOverlayCheckedAt: measured.mediaOverlayCheckedAt,
    };

    const [existingBook] = await tx
      .select({ id: books.id, primaryFileId: books.primaryFileId, status: books.status, formatPriority: libraries.formatPriority })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .where(and(eq(books.libraryId, libraryId), eq(books.folderPath, folderPath)))
      // Held until commit, so a second import filing into the same book waits and then ranks both
      // files, instead of each transaction ranking only the file it can see.
      .for('update', { of: books })
      .limit(1);

    if (existingBook) {
      const [alreadyThere] = await tx.select({ id: bookFiles.id }).from(bookFiles).where(eq(bookFiles.absolutePath, absolutePath)).limit(1);
      const [fileRow] = await tx
        .insert(bookFiles)
        .values({ ...values, bookId: existingBook.id })
        .onConflictDoUpdate({ target: bookFiles.absolutePath, set: { ...values, bookId: existingBook.id } })
        .returning({ id: bookFiles.id });
      if (!fileRow) throw new InternalServerErrorException('Failed to create book file');
      return {
        bookId: existingBook.id,
        createdBook: false,
        fileId: fileRow.id,
        createdFile: alreadyThere === undefined,
        joinedBook: existingBook,
      };
    }

    const [book] = await tx.insert(books).values({ libraryId, libraryFolderId, folderPath, status: 'present' }).returning({ id: books.id });
    if (!book) throw new InternalServerErrorException('Failed to create book record');

    // Always create an empty metadata row so joins never return null (mirrors scanner behaviour).
    await tx.insert(bookMetadata).values({ bookId: book.id });

    const [fileRow] = await tx
      .insert(bookFiles)
      .values({ ...values, bookId: book.id })
      .returning({ id: bookFiles.id });
    if (!fileRow) throw new InternalServerErrorException('Failed to create book file');

    await tx.update(books).set({ primaryFileId: fileRow.id }).where(eq(books.id, book.id));

    return { bookId: book.id, createdBook: true, fileId: fileRow.id, createdFile: true, joinedBook: null };
  }

  /**
   * Re-ranks the primary of a book that files were just added to, as the scanner would. Without it
   * the book kept whichever file created it, so an EPUB that arrived first stayed primary in a
   * library that ranks audiobooks first. A missing book is left alone: its other rows describe files
   * that are gone, and the scanner re-ranks it when it restores the book.
   */
  private async reselectPrimaryFile(tx: Tx, book: JoinedBook): Promise<ReplacedPrimary | null> {
    if (book.status === 'missing') return null;

    const contentFiles = await tx
      .select({
        id: bookFiles.id,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
      })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, book.id), eq(bookFiles.role, 'content')))
      .orderBy(asc(bookFiles.id));

    const winner = selectPrimaryFileKeepingCurrent(contentFiles, book.primaryFileId, book.formatPriority);
    // No winner means every file is empty, and clearing a primary over that is worse than keeping it.
    if (!winner || winner.id === book.primaryFileId) return null;

    await tx.update(books).set({ primaryFileId: winner.id, updatedAt: new Date() }).where(eq(books.id, book.id));
    return { bookId: book.id, previousPrimaryFileId: book.primaryFileId, primaryFileId: winner.id };
  }

  /**
   * Puts back the primary a unit replaced. Deleting the unit's rows has already cleared a primary
   * that pointed at one of them, so a cleared primary or the one this unit chose is ours to undo;
   * anything else was chosen since, and stays.
   */
  private async restorePrimaryFile(tx: Tx, replaced: ReplacedPrimary): Promise<void> {
    const previous = replaced.previousPrimaryFileId;
    await tx
      .update(books)
      .set({ primaryFileId: previous, updatedAt: new Date() })
      .where(
        and(
          eq(books.id, replaced.bookId),
          or(isNull(books.primaryFileId), eq(books.primaryFileId, replaced.primaryFileId)),
          previous === null
            ? undefined
            : sql`EXISTS (SELECT 1 FROM ${bookFiles} WHERE ${bookFiles.id} = ${previous} AND ${bookFiles.bookId} = ${replaced.bookId})`,
        ),
      );
  }

  processNewBookImportAsync(bookId: number, libraryId: number, absolutePath: string, format: string): void {
    void this.processNewBookImport(bookId, libraryId, absolutePath, format);
  }

  processNewBookImport(bookId: number, libraryId: number, absolutePath: string, format: string): Promise<void> {
    return this.runNewBookImport(bookId, libraryId, absolutePath, format);
  }

  /**
   * Fires-and-forgets metadata + cover extraction.
   * Errors are logged but never surfaced to the caller.
   */
  extractMetadataAsync(bookId: number, absolutePath: string, format: string): void {
    if (!METADATA_FORMATS.has(format)) return;

    const event = 'upload.extract_metadata';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] bookId=${bookId} format=${format} - metadata extraction started`);
    void this.runMetadataExtraction(bookId, absolutePath, format, event, startedAt);
  }

  extractMetadata(bookId: number, absolutePath: string, format: string): Promise<void> {
    if (!METADATA_FORMATS.has(format)) return Promise.resolve();
    return this.runMetadataExtraction(bookId, absolutePath, format, 'upload.extract_metadata', Date.now());
  }

  private async runMetadataExtraction(bookId: number, absolutePath: string, format: string, event: string, startedAt: number): Promise<void> {
    try {
      const fileSize = await stat(absolutePath)
        .then((value) => value.size)
        .catch(() => 0);
      if (FORMATS_WITH_UNBOUNDED_METADATA_READS.has(format) && fileSize > MAX_BUFFERED_METADATA_BYTES) {
        this.logger.warn(
          `[${event}] [end] bookId=${bookId} format=${format} sizeBytes=${fileSize} durationMs=${Date.now() - startedAt} skipped=true - metadata extraction skipped because the parser is not bounded for this file size`,
        );
        return;
      }
      await this.metadataService.extractAndSave(bookId, absolutePath, format);
      // The embedded extractor writes the aggregate duration to book_metadata, but the
      // per-file book_files.durationSeconds the player sums is only populated here.
      if (isAudioFormat(format)) {
        await this.metadataService.extractAndAggregateAudioDuration(bookId, absolutePath);
      }
      this.reconcileCoversAsync([bookId]);
      this.logger.debug(`[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} - metadata extraction completed`);
    } catch (err) {
      const error = err as Error;
      const errorClass = error.name ?? 'Error';
      const errorMessage = sanitizeLogValue(error.message);
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
      );
    }
  }

  private async runNewBookImport(bookId: number, libraryId: number, absolutePath: string, format: string): Promise<void> {
    const event = 'upload.process_new_book_import';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] libraryId=${libraryId} bookId=${bookId} format=${format} - new book import processing started`);

    if (METADATA_FORMATS.has(format)) {
      await this.runMetadataExtraction(bookId, absolutePath, format, 'upload.extract_metadata', startedAt);
    }

    if (!this.autoFetchOrchestrator) {
      this.logger.debug(
        `[${event}] [end] libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} scheduled=false - new book import processing completed`,
      );
      return;
    }

    try {
      const queued = await this.autoFetchOrchestrator.scheduleImportedBooksIfEligible(libraryId, [bookId]);
      this.logger.debug(
        `[${event}] [end] libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} scheduled=true queued=${queued} - new book import processing completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata fetch scheduling failed`,
      );
    }
  }

  /**
   * Fires-and-forgets per-file audio duration extraction for a file added to an existing book.
   * Unlike {@link extractMetadataAsync} this never overwrites shared book metadata (title, cover, etc.)
   * Non-audio formats are ignored. Errors are logged but never surfaced to the caller.
   */
  extractAudioDurationAsync(bookId: number, absolutePath: string, format: string): void {
    if (!isAudioFormat(format)) return;

    const event = 'book.extract_audio_duration';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] bookId=${bookId} format=${format} - audio duration extraction started`);
    this.metadataService
      .extractAndAggregateAudioDuration(bookId, absolutePath)
      .then(() => {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} - audio duration extraction completed`,
        );
      })
      .catch((err: Error) => {
        const errorClass = err.name ?? 'Error';
        const errorMessage = sanitizeLogValue(err.message);
        this.logger.warn(
          `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - audio duration extraction failed`,
        );
      });
  }

  extractAddedAudioChaptersAsync(bookId: number, format: string): void {
    if (!isAudioFormat(format)) return;

    const event = 'book.extract_added_audio_chapters';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] bookId=${bookId} format=${format} - added audio chapter extraction started`);
    this.extractAddedAudioChapters(bookId)
      .then(() => {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} - added audio chapter extraction completed`,
        );
      })
      .catch((err: Error) => {
        const errorClass = err.name ?? 'Error';
        const errorMessage = sanitizeLogValue(err.message);
        this.logger.warn(
          `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - added audio chapter extraction failed`,
        );
      });
  }

  private async extractAddedAudioChapters(bookId: number): Promise<void> {
    const files = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'content'), inArray(bookFiles.format, [...METADATA_AUDIO_FORMATS])));
    const orderedFiles = files.sort((left, right) => naturalCompare(basename(left.absolutePath), basename(right.absolutePath)));
    const firstAudio = orderedFiles[0];
    if (!firstAudio?.format) return;
    await this.metadataService.extractAudioChaptersAndNarrators(bookId, firstAudio.absolutePath, firstAudio.format);
    if (orderedFiles.length > 1) {
      await this.metadataService.extractMergedAudioChapters(
        bookId,
        orderedFiles.map((file) => file.absolutePath),
        { filesChanged: true },
      );
    }
  }
}
