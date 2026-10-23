import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { recordBookFileHashHistory } from '../../db/book-file-hash-history';

@Injectable()
export class KoboDownloadRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  findBook(bookId: number) {
    return this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true, primaryFileId: true },
    });
  }

  findPrimaryFile(bookId: number, fileId: number) {
    return this.db.query.bookFiles.findFirst({
      where: and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.id, fileId)),
    });
  }

  async registerDeliveredHash(bookFileId: number, fileHash: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // A busy library must fall back to the durable queue before delaying the download.
      await tx.execute(sql`set local lock_timeout = '1s'`);
      await recordBookFileHashHistory(tx, bookFileId, fileHash, 'kobo_download');
    });
  }

  async findCachedSourceFileId(bookId: number, sourceHash: string): Promise<number | null> {
    const matches = await this.db
      .selectDistinct({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .leftJoin(
        schema.bookFileHashHistory,
        and(
          eq(schema.bookFileHashHistory.bookFileId, schema.bookFiles.id),
          eq(schema.bookFileHashHistory.fileHash, sourceHash),
          ne(schema.bookFileHashHistory.reason, 'kobo_download'),
        ),
      )
      .where(
        and(
          eq(schema.bookFiles.bookId, bookId),
          eq(schema.bookFiles.role, 'content'),
          or(eq(schema.bookFiles.fileHash, sourceHash), eq(schema.bookFileHashHistory.fileHash, sourceHash)),
        ),
      )
      .limit(2);
    return matches.length === 1 ? matches[0]!.id : null;
  }
}
