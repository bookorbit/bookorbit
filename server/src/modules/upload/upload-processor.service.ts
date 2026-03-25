import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'fb2', 'pdf']);

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

    const insertedBooks = (await this.db.insert(books).values({ libraryId, libraryFolderId, folderPath, status: 'present' }).returning()) as Array<{
      id: number;
    }>;
    const book = insertedBooks[0];
    if (!book) throw new Error('Failed to create book record');

    // Always create an empty metadata row so joins never return null (mirrors scanner behaviour).
    await this.db.insert(bookMetadata).values({ bookId: book.id });

    const insertedFiles = (await this.db
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
      .returning()) as Array<{ id: number }>;
    const file = insertedFiles[0];
    if (!file) throw new Error('Failed to create book file');

    await this.db.update(books).set({ primaryFileId: file.id }).where(eq(books.id, book.id));

    this.autoFetchOrchestrator
      ?.scheduleIfEligible(book.id, libraryId, 'event_import')
      .catch((err: Error) => this.logger.warn(`book-metadata-fetch schedule failed for book ${book.id}: ${err.message}`));

    return { bookId: book.id };
  }

  /**
   * Fires-and-forgets metadata + cover extraction.
   * Errors are logged but never surfaced to the caller.
   */
  extractMetadataAsync(bookId: number, absolutePath: string, format: string): void {
    if (!METADATA_FORMATS.has(format)) return;

    this.logger.debug(`[upload.metadata] [start] book=${bookId} format=${format}`);
    this.metadataService
      .extractAndSave(bookId, absolutePath, format)
      .then(() => {
        this.logger.debug(`[upload.metadata] [success] book=${bookId}`);
      })
      .catch((err: Error) => {
        this.logger.warn(`[upload.metadata] [fail] book=${bookId} error="${err.message}"`);
      });
  }
}
