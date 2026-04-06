import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { WriteResult, WriteLogEntry } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, books, fileWriteLog, genres, libraries, tags, bookTags } from '../../db/schema';

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
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  async findLibraryFileWriteConfig(libraryId: number) {
    const [row] = await this.db
      .select({
        fileWriteEnabled: libraries.fileWriteEnabled,
        fileWriteWriteCover: libraries.fileWriteWriteCover,
        fileWriteEpubEnabled: libraries.fileWriteEpubEnabled,
        fileWriteEpubMaxFileSizeMb: libraries.fileWriteEpubMaxFileSizeMb,
        fileWritePdfEnabled: libraries.fileWritePdfEnabled,
        fileWritePdfMaxFileSizeMb: libraries.fileWritePdfMaxFileSizeMb,
        fileWriteCbxEnabled: libraries.fileWriteCbxEnabled,
        fileWriteCbxMaxFileSizeMb: libraries.fileWriteCbxMaxFileSizeMb,
      })
      .from(libraries)
      .where(eq(libraries.id, libraryId))
      .limit(1);
    return row ?? null;
  }

  async findNonMissingPrimaryFilesByLibrary(libraryId: number) {
    return this.db
      .select({
        bookId: books.id,
        bookFileId: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing')))
      .orderBy(asc(books.id));
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
        .where(eq(bookGenres.bookId, bookId))
        .orderBy(asc(genres.name)),
      this.db
        .select({ name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(eq(bookTags.bookId, bookId))
        .orderBy(asc(tags.name)),
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
      fieldsWritten: normalizeFieldsWritten(r.fieldsWritten),
      triggeredBy: r.triggeredBy,
      writtenAt: r.writtenAt.toISOString(),
      durationMs: r.durationMs,
      errorMessage: r.errorMessage,
    }));
  }
}

function normalizeFieldsWritten(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
