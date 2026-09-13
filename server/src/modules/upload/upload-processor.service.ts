import { Inject, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { stat } from 'fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isAudioFormat } from '@bookorbit/types';
import type { FileRole as BookFileRole } from '../scanner/lib/classify';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books } from '../../db/schema';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { computeFileHash } from '../scanner/lib/hash';

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
 * book alone.
 */
export interface UnitBookRecords {
  /** Every book the unit touched, primary first. */
  bookIds: number[];
  createdBookIds: number[];
  attachedFileIds: number[];
}

interface MeasuredFile {
  ino: bigint;
  mtime: Date;
  fileHash: string;
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
    @Optional() private readonly autoFetchOrchestrator?: BookMetadataFetchOrchestratorService,
  ) {}

  /**
   * One `book_files` row, attached to the book that owns `folderPath` or to a new one. Calling it
   * repeatedly with the same `folderPath` is how a multi-file unit becomes one book with many
   * files, and it is why the caller must pass the **primary file first**: `primaryFileId` is set
   * only on the call that creates the book.
   */
  async createBookRecord(
    libraryId: number,
    libraryFolderId: number,
    folderPath: string,
    absolutePath: string,
    relPath: string,
    format: string,
    sizeBytes: number,
    options: { role?: BookFileRole; sortOrder?: number | null } = {},
  ): Promise<{ bookId: number; created: boolean }> {
    const measured = await this.measureFile(absolutePath);
    const result = await this.db.transaction((tx) =>
      this.upsertBookFile(tx, libraryId, libraryFolderId, { folderPath, absolutePath, relPath, format, sizeBytes, ...options }, measured),
    );
    return { bookId: result.bookId, created: result.createdBook };
  }

  /**
   * Every file of one unit in a single transaction. `createBookRecord` opens its own transaction
   * per call, so filing a 31-track audiobook through it committed 31 times and a failure on track
   * three left the first two behind as a ghost book. Here nothing is visible until all of it is.
   *
   * Files must arrive **primary first**: `primaryFileId` is set on the row that creates the book.
   */
  async createUnitBookRecords(libraryId: number, libraryFolderId: number, files: UnitBookFileInput[]): Promise<UnitBookRecords> {
    if (files.length === 0) throw new InternalServerErrorException('Cannot create a book from an empty unit');

    // Hashing is the expensive half and needs no transaction, so it happens before one is open
    // rather than holding a write transaction for the length of a 31-track read.
    const measured: MeasuredFile[] = [];
    for (const file of files) measured.push(await this.measureFile(file.absolutePath));

    return this.db.transaction(async (tx) => {
      const bookIds: number[] = [];
      const createdBookIds: number[] = [];
      const attachedFileIds: number[] = [];

      for (const [index, file] of files.entries()) {
        const result = await this.upsertBookFile(tx, libraryId, libraryFolderId, file, measured[index]!);
        if (!bookIds.includes(result.bookId)) bookIds.push(result.bookId);
        if (result.createdBook) createdBookIds.push(result.bookId);
        // A row on a book this unit created goes away with the book, so only rows attached to a
        // book that was already there need remembering - and only the ones actually inserted,
        // never one that was already pointing at that path.
        else if (result.createdFile && !createdBookIds.includes(result.bookId)) attachedFileIds.push(result.fileId);
      }

      return { bookIds, createdBookIds, attachedFileIds };
    });
  }

  /**
   * Takes back exactly what {@link createUnitBookRecords} wrote. Books it created go entirely,
   * taking their files and metadata with them through the cascade; books it only attached to keep
   * everything except the rows this unit added.
   */
  async deleteUnitBookRecords(records: UnitBookRecords): Promise<void> {
    if (records.createdBookIds.length === 0 && records.attachedFileIds.length === 0) return;

    await this.db.transaction(async (tx) => {
      if (records.attachedFileIds.length > 0) {
        await tx.delete(bookFiles).where(inArray(bookFiles.id, records.attachedFileIds));
      }
      if (records.createdBookIds.length > 0) {
        // `books.primary_file_id` is `on delete set null`, so clearing the files first leaves
        // nothing pointing at a row that is about to disappear.
        await tx.delete(bookFiles).where(inArray(bookFiles.bookId, records.createdBookIds));
        await tx.delete(books).where(inArray(books.id, records.createdBookIds));
      }
    });
  }

  private async measureFile(absolutePath: string): Promise<MeasuredFile> {
    const [fileStat, fileHash] = await Promise.all([stat(absolutePath, { bigint: true }), computeFileHash(absolutePath)]);
    return { ino: fileStat.ino, mtime: fileStat.mtime, fileHash };
  }

  private async upsertBookFile(
    tx: Tx,
    libraryId: number,
    libraryFolderId: number,
    file: UnitBookFileInput,
    measured: MeasuredFile,
  ): Promise<{ bookId: number; createdBook: boolean; fileId: number; createdFile: boolean }> {
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
    };

    const [existingBook] = await tx
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.folderPath, folderPath)))
      .limit(1);

    if (existingBook) {
      const [alreadyThere] = await tx.select({ id: bookFiles.id }).from(bookFiles).where(eq(bookFiles.absolutePath, absolutePath)).limit(1);
      const [fileRow] = await tx
        .insert(bookFiles)
        .values({ ...values, bookId: existingBook.id })
        .onConflictDoUpdate({ target: bookFiles.absolutePath, set: { ...values, bookId: existingBook.id } })
        .returning({ id: bookFiles.id });
      if (!fileRow) throw new InternalServerErrorException('Failed to create book file');
      return { bookId: existingBook.id, createdBook: false, fileId: fileRow.id, createdFile: alreadyThere === undefined };
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

    return { bookId: book.id, createdBook: true, fileId: fileRow.id, createdFile: true };
  }

  processNewBookImportAsync(bookId: number, libraryId: number, absolutePath: string, format: string): void {
    void this.runNewBookImport(bookId, libraryId, absolutePath, format);
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

  private async runMetadataExtraction(bookId: number, absolutePath: string, format: string, event: string, startedAt: number): Promise<void> {
    try {
      await this.metadataService.extractAndSave(bookId, absolutePath, format);
      // The embedded extractor writes the aggregate duration to book_metadata, but the
      // per-file book_files.durationSeconds the player sums is only populated here.
      if (isAudioFormat(format)) {
        await this.metadataService.extractAndAggregateAudioDuration(bookId, absolutePath);
      }
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
}
