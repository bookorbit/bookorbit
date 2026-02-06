import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, count, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookTags, libraries, readingProgress, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findCards(opts: { where: SQL | undefined; orderBy: SQL[]; limit: number; offset: number; userId: number }) {
    const { where, orderBy, limit, offset, userId } = opts;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: books.id,
          status: books.status,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          title: bookMetadata.title,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          publishedYear: bookMetadata.publishedYear,
          language: bookMetadata.language,
          rating: bookMetadata.rating,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    const bookIds = rows.map((r) => r.id);

    const [authorRows, fileRows, tagRows] = await Promise.all([
      bookIds.length > 0
        ? this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds))
            .orderBy(bookAuthors.displayOrder)
        : [],
      bookIds.length > 0
        ? this.db
            .select({ bookId: bookFiles.bookId, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role })
            .from(bookFiles)
            .where(inArray(bookFiles.bookId, bookIds))
        : [],
      bookIds.length > 0
        ? this.db
            .select({ bookId: bookTags.bookId, name: tags.name })
            .from(bookTags)
            .innerJoin(tags, eq(tags.id, bookTags.tagId))
            .where(inArray(bookTags.bookId, bookIds))
        : [],
    ]);

    const primaryFileIds = fileRows.filter((f) => f.role === 'primary').map((f) => f.id);
    const progressRows =
      primaryFileIds.length > 0
        ? await this.db
            .select({ bookFileId: readingProgress.bookFileId, percentage: readingProgress.percentage })
            .from(readingProgress)
            .where(and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, primaryFileIds)))
        : [];

    return { rows, authorRows, fileRows, tagRows, progressRows, total: Number(total) };
  }

  async findById(id: number) {
    const [book] = await this.db.select().from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(eq(books.id, id)).limit(1);

    if (!book) return null;

    const [authorRows, tagRows, fileRows] = await Promise.all([
      this.db
        .select({ id: authors.id, name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, id))
        .orderBy(bookAuthors.displayOrder),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, id)),
      this.db
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
          createdAt: bookFiles.createdAt,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, id)),
    ]);

    return { book, authorRows, tagRows, fileRows };
  }

  async findLibraryIdByBookId(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    return row?.libraryId ?? null;
  }

  async findFileById(fileId: number) {
    const [file] = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        bookId: bookFiles.bookId,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, fileId))
      .limit(1);
    return file ?? null;
  }

  async findProgress(userId: number, fileId: number) {
    const [row] = await this.db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.bookFileId, fileId), eq(readingProgress.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async searchAcrossLibraries(libraryIds: number[], q: string, limit: number) {
    if (libraryIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        libraryId: books.libraryId,
        libraryName: libraries.name,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(and(inArray(books.libraryId, libraryIds), sql`${bookMetadata.title} ILIKE ${'%' + q + '%'}`))
      .orderBy(bookMetadata.title)
      .limit(limit);

    const bookIds = rows.map((r) => r.id);

    const authorRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds))
            .orderBy(bookAuthors.displayOrder)
        : [];

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      authors: authorsByBook.get(r.id) ?? [],
      libraryId: r.libraryId,
      libraryName: r.libraryName,
    }));
  }

  async countWhere(where: SQL | undefined): Promise<number> {
    const [{ total }] = await this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where);
    return total;
  }

  async updateRating(bookId: number, rating: number | null): Promise<void> {
    await this.db.insert(bookMetadata).values({ bookId, rating }).onConflictDoUpdate({ target: bookMetadata.bookId, set: { rating } });
  }

  async upsertProgress(userId: number, fileId: number, cfi: string | null, pageNumber: number | null, percentage: number) {
    await this.db
      .insert(readingProgress)
      .values({ userId, bookFileId: fileId, cfi, pageNumber, percentage })
      .onConflictDoUpdate({
        target: [readingProgress.bookFileId, readingProgress.userId],
        set: { cfi, pageNumber, percentage, updatedAt: sql`now()` },
      });
  }
}
