import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookCard } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, books, genres, readingProgress } from '../../db/schema';
import { assembleBookCards } from '../book/utils/assemble-book-cards';

type Db = NodePgDatabase<typeof schema>;

const BOOK_CARD_FIELDS = {
  id: books.id,
  status: books.status,
  primaryFileId: books.primaryFileId,
  folderPath: books.folderPath,
  addedAt: books.addedAt,
  title: bookMetadata.title,
  seriesName: bookMetadata.seriesName,
  seriesIndex: bookMetadata.seriesIndex,
  publishedYear: bookMetadata.publishedYear,
  language: bookMetadata.language,
  rating: bookMetadata.rating,
};

@Injectable()
export class DashboardRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async fetchSupplementary(bookIds: number[], userId: number) {
    if (bookIds.length === 0) {
      return { authorRows: [], fileRows: [], genreRows: [], progressRows: [] };
    }

    const [authorRows, fileRows, genreRows, primaryRows] = await Promise.all([
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: bookFiles.bookId, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role })
        .from(bookFiles)
        .where(inArray(bookFiles.bookId, bookIds)),
      this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(inArray(bookGenres.bookId, bookIds)),
      this.db.select({ id: books.id, primaryFileId: books.primaryFileId }).from(books).where(inArray(books.id, bookIds)),
    ]);

    const primaryFileIds = primaryRows.map((r) => r.primaryFileId).filter((id): id is number => id != null);
    const progressRows =
      primaryFileIds.length > 0
        ? await this.db
            .select({ bookFileId: readingProgress.bookFileId, percentage: readingProgress.percentage })
            .from(readingProgress)
            .where(and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, primaryFileIds)))
        : [];

    return { authorRows, fileRows, genreRows, progressRows };
  }

  async findRecentlyAdded(accessibleLibraryIds: number[], userId: number, limit: number): Promise<BookCard[]> {
    const rows = await this.db
      .select(BOOK_CARD_FIELDS)
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(inArray(books.libraryId, accessibleLibraryIds))
      .orderBy(desc(books.addedAt))
      .limit(limit);

    const bookIds = rows.map((r) => r.id);
    const { authorRows, fileRows, genreRows, progressRows } = await this.fetchSupplementary(bookIds, userId);
    return assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows);
  }

  async findContinueReading(accessibleLibraryIds: number[], userId: number, limit: number): Promise<BookCard[]> {
    const rawRows = await this.db
      .select(BOOK_CARD_FIELDS)
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .innerJoin(
        readingProgress,
        and(
          eq(readingProgress.bookFileId, bookFiles.id),
          eq(readingProgress.userId, userId),
          gt(readingProgress.percentage, 0),
          lt(readingProgress.percentage, 100),
        ),
      )
      .where(inArray(books.libraryId, accessibleLibraryIds))
      .orderBy(desc(readingProgress.updatedAt))
      .limit(limit);

    const seen = new Set<number>();
    const rows = rawRows.filter((r) => !seen.has(r.id) && seen.add(r.id));

    const bookIds = rows.map((r) => r.id);
    const { authorRows, fileRows, genreRows, progressRows } = await this.fetchSupplementary(bookIds, userId);
    return assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows);
  }

  async findRandom(accessibleLibraryIds: number[], userId: number, limit: number): Promise<BookCard[]> {
    const rawRows = await this.db
      .select(BOOK_CARD_FIELDS)
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(and(inArray(books.libraryId, accessibleLibraryIds), or(isNull(readingProgress.bookFileId), eq(readingProgress.percentage, 0))))
      .orderBy(sql.raw('RANDOM()'))
      .limit(limit);

    const seen = new Set<number>();
    const rows = rawRows.filter((r) => !seen.has(r.id) && seen.add(r.id));

    const bookIds = rows.map((r) => r.id);
    const { authorRows, fileRows, genreRows, progressRows } = await this.fetchSupplementary(bookIds, userId);
    return assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows);
  }
}
