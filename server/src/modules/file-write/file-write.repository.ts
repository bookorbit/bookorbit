import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { WriteResult, WriteLogEntry } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  bookNarrators,
  books,
  comicMetadata,
  fileWriteLog,
  genres,
  libraries,
  narrators,
  tags,
  bookTags,
} from '../../db/schema';

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
        fileHash: bookFiles.fileHash,
        libraryId: books.libraryId,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  async findLibraryWriteSettingsForBook(bookId: number): Promise<{ fileWriteEnabled: boolean; fileRenameEnabled: boolean } | null> {
    const [row] = await this.db
      .select({
        fileWriteEnabled: libraries.fileWriteEnabled,
        fileRenameEnabled: libraries.fileRenameEnabled,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
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
        fileWriteAudioEnabled: libraries.fileWriteAudioEnabled,
        fileWriteAudioMaxFileSizeMb: libraries.fileWriteAudioMaxFileSizeMb,
      })
      .from(libraries)
      .where(eq(libraries.id, libraryId))
      .limit(1);
    return row ?? null;
  }

  async findFilesForBook(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        fileHash: bookFiles.fileHash,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
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

  async updateFileHash(bookFileId: number, fileHash: string): Promise<void> {
    await this.db.update(bookFiles).set({ fileHash, updatedAt: new Date() }).where(eq(bookFiles.id, bookFileId));
  }

  async recordHashHistory(bookFileId: number, fileHash: string, reason: string): Promise<void> {
    await this.db.insert(schema.bookFileHashHistory).values({ bookFileId, fileHash, reason }).onConflictDoNothing();
  }

  async loadPayload(bookId: number) {
    const [meta] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    if (!meta) return null;

    const [authorRows, narratorRows, genreRows, tagRows, comicRows] = await Promise.all([
      this.db
        .select({ name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, bookId))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ name: narrators.name })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(eq(bookNarrators.bookId, bookId))
        .orderBy(bookNarrators.displayOrder),
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
      this.db
        .select({
          issueNumber: comicMetadata.issueNumber,
          volumeName: comicMetadata.volumeName,
          pencillers: comicMetadata.pencillers,
          inkers: comicMetadata.inkers,
          colorists: comicMetadata.colorists,
          letterers: comicMetadata.letterers,
          coverArtists: comicMetadata.coverArtists,
          characters: comicMetadata.characters,
          teams: comicMetadata.teams,
          locations: comicMetadata.locations,
          storyArcs: comicMetadata.storyArcs,
        })
        .from(comicMetadata)
        .where(eq(comicMetadata.bookId, bookId))
        .limit(1),
    ]);
    const comic = comicRows[0] ?? null;

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
      googleBooksId: meta.googleBooksId,
      goodreadsId: meta.goodreadsId,
      amazonId: meta.amazonId,
      hardcoverId: meta.hardcoverId,
      openLibraryId: meta.openLibraryId,
      ranobedbId: meta.ranobedbId,
      itunesId: meta.itunesId,
      audibleId: meta.audibleId,
      rating: meta.rating,
      authors: authorRows,
      narrators: narratorRows.map((n) => n.name),
      genres: genreRows.map((g) => g.name),
      tags: tagRows.map((t) => t.name),
      comicIssueNumber: comic?.issueNumber ?? null,
      comicVolumeName: comic?.volumeName ?? null,
      comicPencillers: comic?.pencillers ?? [],
      comicInkers: comic?.inkers ?? [],
      comicColorists: comic?.colorists ?? [],
      comicLetterers: comic?.letterers ?? [],
      comicCoverArtists: comic?.coverArtists ?? [],
      comicCharacters: comic?.characters ?? [],
      comicTeams: comic?.teams ?? [],
      comicLocations: comic?.locations ?? [],
      comicStoryArcs: comic?.storyArcs ?? [],
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
