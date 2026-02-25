import { Inject, Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books } from '../../db/schema';
import { MetadataService } from '../metadata/metadata.service';
import { sha256File } from '../scanner/lib/hash';

type Db = NodePgDatabase<typeof schema>;

const METADATA_FORMATS = new Set(['epub', 'mobi', 'azw3', 'azw', 'cbz', 'cbr', 'cb7', 'pdf']);

@Injectable()
export class UploadProcessorService {
  private readonly logger = new Logger(UploadProcessorService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly metadataService: MetadataService,
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
    const [fileStat, hash] = await Promise.all([stat(absolutePath), sha256File(absolutePath)]);

    const [book] = await this.db.insert(books).values({ libraryId, libraryFolderId, folderPath, status: 'present' }).returning();

    // Always create an empty metadata row so joins never return null (mirrors scanner behaviour).
    await this.db.insert(bookMetadata).values({ bookId: book.id });

    await this.db.insert(bookFiles).values({
      bookId: book.id,
      libraryFolderId,
      absolutePath,
      relPath,
      ino: fileStat.ino,
      sizeBytes,
      mtime: fileStat.mtime,
      hash,
      format,
      role: 'primary',
    });

    return { bookId: book.id };
  }

  /**
   * Fires-and-forgets metadata + cover extraction.
   * Errors are logged but never surfaced to the caller.
   */
  extractMetadataAsync(bookId: number, absolutePath: string, format: string): void {
    if (!METADATA_FORMATS.has(format)) return;

    this.metadataService
      .extractAndSave(bookId, absolutePath, format)
      .catch((err: Error) => this.logger.warn(`Metadata extraction failed for uploaded book ${bookId}: ${err.message}`));
  }
}
