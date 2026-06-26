import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';

type Db = NodePgDatabase<typeof schema>;

export type KoboAnalyticsResolveResult =
  | { kind: 'resolved'; bookFileId: number }
  | { kind: 'skipped'; reason: 'book_not_found' | 'book_not_accessible' | 'no_epub_file' };

@Injectable()
export class KoboAnalyticsResolverService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
  ) {}

  async resolveBookFileId(userId: number, bookId: number): Promise<KoboAnalyticsResolveResult> {
    try {
      await this.bookAccessService.assertBookAccessible(userId, bookId);
    } catch {
      return { kind: 'skipped', reason: 'book_not_accessible' };
    }

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true, primaryFileId: true },
    });
    if (!book) return { kind: 'skipped', reason: 'book_not_found' };

    const snap = await this.db
      .select({ fileHash: schema.koboSnapshotBooks.fileHash })
      .from(schema.koboSnapshotBooks)
      .innerJoin(schema.koboLibrarySnapshots, eq(schema.koboLibrarySnapshots.id, schema.koboSnapshotBooks.snapshotId))
      .where(and(eq(schema.koboLibrarySnapshots.userId, userId), eq(schema.koboSnapshotBooks.bookId, bookId)))
      .orderBy(desc(schema.koboLibrarySnapshots.id))
      .limit(1);

    const snapHash = snap[0]?.fileHash ?? null;
    if (snapHash) {
      const byHash = await this.db
        .select({ id: schema.bookFiles.id })
        .from(schema.bookFiles)
        .where(
          and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.fileHash, snapHash), inArray(schema.bookFiles.format, ['epub', 'kepub'])),
        );

      if (byHash.length === 1) {
        return { kind: 'resolved', bookFileId: byHash[0].id };
      }
      if (byHash.length > 1) {
        const primary = byHash.find((f) => f.id === book.primaryFileId);
        return { kind: 'resolved', bookFileId: primary?.id ?? Math.min(...byHash.map((f) => f.id)) };
      }
    }

    if (book.primaryFileId == null) return { kind: 'skipped', reason: 'no_epub_file' };

    const primary = await this.db.query.bookFiles.findFirst({
      where: and(eq(schema.bookFiles.id, book.primaryFileId), inArray(schema.bookFiles.format, ['epub', 'kepub'])),
      columns: { id: true },
    });
    if (!primary) return { kind: 'skipped', reason: 'no_epub_file' };

    return { kind: 'resolved', bookFileId: primary.id };
  }
}
