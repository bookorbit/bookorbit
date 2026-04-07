import { Inject, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { stat } from 'fs/promises';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books } from '../../db/schema';
import { BookMetadataFetchOrchestratorService } from '../book-metadata-fetch/book-metadata-fetch-orchestrator.service';
import { MetadataService } from '../metadata/metadata.service';
import { fingerprintFile } from '../scanner/lib/hash';

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
    const [fileStat, hash] = await Promise.all([stat(absolutePath), fingerprintFile(absolutePath)]);

    const { bookId } = await this.db.transaction(async (tx) => {
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
          ino: fileStat.ino,
          sizeBytes,
          mtime: fileStat.mtime,
          hash,
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
      const errorMessage = err.message.replace(/"/g, '\\"');
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
    this.metadataService
      .extractAndSave(bookId, absolutePath, format)
      .then(() => {
        this.logger.debug(`[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} - metadata extraction completed`);
      })
      .catch((err: Error) => {
        const errorClass = err.name ?? 'Error';
        const errorMessage = err.message.replace(/"/g, '\\"');
        this.logger.warn(
          `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
        );
      });
  }
}
