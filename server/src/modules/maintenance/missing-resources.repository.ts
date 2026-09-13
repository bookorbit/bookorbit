import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const authorsSubquery = sql<string[]>`COALESCE((
  SELECT array_agg(author.name ORDER BY book_author.display_order, author.id)
  FROM book_authors book_author
  JOIN authors author ON author.id = book_author.author_id
  WHERE book_author.book_id = ${books.id}
), ARRAY[]::varchar[])`;

const formatsSubquery = sql<string[]>`COALESCE((
  SELECT array_agg(DISTINCT file.format)
  FROM book_files file
  WHERE file.book_id = ${books.id} AND file.format IS NOT NULL
), ARRAY[]::varchar[])`;

@Injectable()
export class MissingResourcesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async countMissingBooks(libraryIds: number[]): Promise<number> {
    if (libraryIds.length === 0) return 0;
    const [row] = await this.db
      .select({ value: count() })
      .from(books)
      .where(and(eq(books.status, 'missing'), inArray(books.libraryId, libraryIds)));
    return row?.value ?? 0;
  }

  async findMissingBooks(libraryIds: number[], offset: number, limit: number) {
    if (libraryIds.length === 0) return [];
    return this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        authors: authorsSubquery,
        libraryId: books.libraryId,
        libraryName: libraries.name,
        folderPath: books.folderPath,
        formats: formatsSubquery,
        updatedAt: books.updatedAt,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(eq(books.status, 'missing'), inArray(books.libraryId, libraryIds)))
      .orderBy(asc(books.libraryId), asc(books.id))
      .offset(offset)
      .limit(limit);
  }

  async findMissingBookIds(libraryIds: number[], afterId: number, limit: number): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.status, 'missing'), inArray(books.libraryId, libraryIds), gt(books.id, afterId)))
      .orderBy(asc(books.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /** Re-verification for cleanup: only ids that are still missing and still in scope survive. */
  async filterStillMissingBookIds(bookIds: number[], libraryIds: number[]): Promise<number[]> {
    if (bookIds.length === 0 || libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.status, 'missing'), inArray(books.libraryId, libraryIds), inArray(books.id, bookIds)));
    return rows.map((row) => row.id);
  }

  async countBooksWithCoverSource(libraryIds: number[]): Promise<number> {
    if (libraryIds.length === 0) return 0;
    const [row] = await this.db
      .select({ value: count() })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(bookMetadata.coverSource), inArray(books.libraryId, libraryIds)));
    return row?.value ?? 0;
  }

  /** Keyset page of books claiming a cover, so the sweep never holds the whole library in memory. */
  async findBookIdsWithCoverSource(libraryIds: number[], afterId: number, limit: number): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(bookMetadata.coverSource), inArray(books.libraryId, libraryIds), gt(books.id, afterId)))
      .orderBy(asc(books.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async findBrokenCoverEntries(bookIds: number[]) {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        authors: authorsSubquery,
        libraryId: books.libraryId,
        libraryName: libraries.name,
        coverSource: bookMetadata.coverSource,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(isNotNull(bookMetadata.coverSource), inArray(books.id, bookIds)))
      .orderBy(asc(books.id));
  }

  async filterBookIdsWithCoverSource(bookIds: number[], libraryIds: number[]): Promise<number[]> {
    if (bookIds.length === 0 || libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(bookMetadata.coverSource), inArray(books.libraryId, libraryIds), inArray(books.id, bookIds)));
    return rows.map((row) => row.id);
  }

  async clearCoverSource(bookIds: number[]): Promise<number> {
    if (bookIds.length === 0) return 0;
    const result = await this.db
      .update(bookMetadata)
      .set({ coverSource: null, coverUpdatedAt: new Date(), updatedAt: new Date() })
      .where(and(isNotNull(bookMetadata.coverSource), inArray(bookMetadata.bookId, bookIds)));
    return result.rowCount ?? 0;
  }

  async findExistingBookIds(bookIds: number[]): Promise<number[]> {
    if (bookIds.length === 0) return [];
    const rows = await this.db.select({ id: books.id }).from(books).where(inArray(books.id, bookIds));
    return rows.map((row) => row.id);
  }
}
