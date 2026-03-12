import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { WriteResult, WriteLogEntry } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, books, fileWriteLog, genres, tags, bookTags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class FileWriteRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPrimaryFileForBook(bookId: number) {
    const [row] = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'primary')))
      .limit(1);
    return row ?? null;
  }

  async findNonMissingBookFilesByLibrary(libraryId: number) {
    return this.db
      .select({
        bookId: books.id,
        bookFileId: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
      })
      .from(books)
      .innerJoin(bookFiles, and(eq(bookFiles.bookId, books.id), eq(bookFiles.role, 'primary')))
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing')));
  }

  async loadPayload(bookId: number) {
    const [meta] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    if (!meta) return null;

    const [authorRows, genreRows, tagRows] = await Promise.all([
      this.db
        .select({ name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(eq(bookGenres.bookId, bookId)),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, bookId)),
    ]);

    return {
      title: meta.title,
      subtitle: meta.subtitle,
      description: meta.description,
      publisher: meta.publisher,
      publishedYear: meta.publishedYear,
      language: meta.language,
      pageCount: meta.pageCount,
      seriesName: meta.seriesName,
      seriesIndex: meta.seriesIndex,
      isbn10: meta.isbn10,
      isbn13: meta.isbn13,
      rating: meta.rating,
      googleBooksId: meta.googleBooksId,
      goodreadsId: meta.goodreadsId,
      amazonId: meta.amazonId,
      hardcoverId: meta.hardcoverId,
      openLibraryId: meta.openLibraryId,
      itunesId: meta.itunesId,
      authors: authorRows,
      genres: genreRows.map((g) => g.name),
      tags: tagRows.map((t) => t.name),
    };
  }

  async insertLog(entry: {
    bookId: number;
    bookFileId: number | null;
    userId: number | null;
    format: string;
    result: WriteResult;
    triggeredBy: 'auto' | 'sync';
  }): Promise<void> {
    await this.db.insert(fileWriteLog).values({
      bookId: entry.bookId,
      bookFileId: entry.bookFileId,
      userId: entry.userId,
      format: entry.format,
      status: entry.result.status,
      fieldsWritten: entry.result.fieldsWritten,
      errorMessage: entry.result.reason ?? null,
      durationMs: entry.result.durationMs,
      triggeredBy: entry.triggeredBy,
    });
  }

  async setLastWrittenAt(bookId: number, writtenAt: Date): Promise<void> {
    await this.db.update(bookMetadata).set({ lastWrittenAt: writtenAt }).where(eq(bookMetadata.bookId, bookId));
  }

  async findWriteLog(bookId: number, limit = 20): Promise<WriteLogEntry[]> {
    const rows = await this.db.select().from(fileWriteLog).where(eq(fileWriteLog.bookId, bookId)).orderBy(desc(fileWriteLog.writtenAt)).limit(limit);

    return rows.map((r) => ({
      id: r.id,
      format: r.format,
      status: r.status,
      fieldsWritten: (r.fieldsWritten as string[]) ?? [],
      triggeredBy: r.triggeredBy,
      writtenAt: r.writtenAt.toISOString(),
      durationMs: r.durationMs,
      errorMessage: r.errorMessage,
    }));
  }
}
