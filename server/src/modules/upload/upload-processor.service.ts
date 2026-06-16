import { Inject, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { stat } from 'fs/promises';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isAudioFormat } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books } from '../../db/schema';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { computeFileHash } from '../scanner/lib/hash';
import { clampIno } from '../scanner/lib/walk';

type Db = NodePgDatabase<typeof schema>;

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

  async createBookRecord(
    libraryId: number,
    libraryFolderId: number,
    folderPath: string,
    absolutePath: string,
    relPath: string,
    format: string,
    sizeBytes: number,
  ): Promise<{ bookId: number }> {
    const [fileStat, fileHash] = await Promise.all([stat(absolutePath, { bigint: true }), computeFileHash(absolutePath)]);
    const safeIno = clampIno(fileStat.ino);

    const { bookId } = await this.db.transaction(async (tx) => {
      const [existingBook] = await tx
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.libraryId, libraryId), eq(books.folderPath, folderPath)))
        .limit(1);

      if (existingBook) {
        const fileValues = {
          bookId: existingBook.id,
          libraryFolderId,
          absolutePath,
          relPath,
          ino: safeIno,
          sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          format,
          role: 'content' as const,
        };
        const [file] = await tx
          .insert(bookFiles)
          .values(fileValues)
          .onConflictDoUpdate({
            target: bookFiles.absolutePath,
            set: { bookId: existingBook.id, libraryFolderId, relPath, ino: safeIno, sizeBytes, mtime: fileStat.mtime, fileHash, format },
          })
          .returning({ id: bookFiles.id });
        if (!file) throw new InternalServerErrorException('Failed to create book file');
        return { bookId: existingBook.id };
      }

      const [book] = await tx.insert(books).values({ libraryId, libraryFolderId, folderPath, status: 'present' }).returning({ id: books.id });
      if (!book) throw new InternalServerErrorException('Failed to create book record');

      // Always create an empty metadata row so joins never return null (mirrors scanner behaviour).
      await tx.insert(bookMetadata).values({ bookId: book.id });

      const [file] = await tx
        .insert(bookFiles)
        .values({
          bookId: book.id,
          libraryFolderId,
          absolutePath,
          relPath,
          ino: safeIno,
          sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          format,
          role: 'content',
        })
        .returning({ id: bookFiles.id });
      if (!file) throw new InternalServerErrorException('Failed to create book file');

      await tx.update(books).set({ primaryFileId: file.id }).where(eq(books.id, book.id));

      return { bookId: book.id };
    });

    const event = 'upload.schedule_metadata_fetch';
    const startedAt = Date.now();
    this.autoFetchOrchestrator?.scheduleIfEligible(bookId, libraryId, 'event_import').catch((err: Error) => {
      const errorClass = err.name ?? 'Error';
      const errorMessage = sanitizeLogValue(err.message);
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata fetch scheduling failed`,
      );
    });

    return { bookId };
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
