import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles } from '../../db/schema';
import { countComicPages } from '../../common/comic-page-counter';
import { getPdfPageCount } from '../../common/pdf-page-count';
import { isPseStreamableFormat } from './opds-xml.helpers';

type Db = NodePgDatabase<typeof schema>;

export interface PseFile {
  id: number;
  format: string;
  absolutePath: string;
  pageCount: number | null;
}

/**
 * Lazily computes and caches the streamable page count for OPDS-PSE.
 *
 * Page count is computed once per file (on first feed render or stream
 * request that needs it) and persisted to `book_files.page_count`, rather
 * than being threaded through the scan/ingestion pipeline: the count is
 * immutable once a file lands on disk, so "compute once, reuse forever" is
 * correct and keeps this feature scoped to the OPDS module.
 */
@Injectable()
export class OpdsPageCountService {
  private readonly logger = new Logger(OpdsPageCountService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async ensure(file: PseFile): Promise<number | null> {
    if (file.pageCount != null) return file.pageCount;
    if (!isPseStreamableFormat(file.format)) return null;

    let count: number;
    try {
      count =
        file.format === 'pdf'
          ? await getPdfPageCount(file.absolutePath)
          : await countComicPages(file.id, file.absolutePath, file.format as 'cbz' | 'cbr' | 'cb7');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[opds.pse_page_count] [fail] fileId=${file.id} format=${file.format} error="${err.message}" - page count unavailable, PSE link omitted`,
      );
      return null;
    }

    await this.db.update(bookFiles).set({ pageCount: count }).where(eq(bookFiles.id, file.id));
    return count;
  }
}
