import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { SUPPORTED_BOOK_FORMATS } from '../upload/upload-validator.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

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
  bookTags,
  collectionBooks,
  collections,
  genres,
  koboLibrarySnapshots,
  koboReadingStates,
  koboSnapshotBooks,
  libraries,
  narrators,
  audiobookProgress,
  readingProgress,
  tags,
  userBookStatus,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type MetadataUpdateExecutor = Pick<Db, 'update'>;
type PatternMetadataRow = {
  bookId: number;
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  isbn13: string | null;
  authors: string[];
};

@Injectable()
export class BookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async withTransaction<T>(callback: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx));
  }

  async findCards(opts: { where: SQL | undefined; orderBy: SQL[]; limit: number; offset: number; userId: number }) {
    const { where, orderBy, limit, offset, userId } = opts;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
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

    const [authorRows, fileRows, genreRows] = await Promise.all([
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
        : ([] as { bookId: number; id: number; format: string | null; role: string }[]),
      bookIds.length > 0
        ? this.db
            .select({ bookId: bookGenres.bookId, name: genres.name })
            .from(bookGenres)
            .innerJoin(genres, eq(genres.id, bookGenres.genreId))
            .where(inArray(bookGenres.bookId, bookIds))
        : [],
    ]);

    const primaryFileIds = rows.map((r) => r.primaryFileId).filter((id): id is number => id != null);
    const [progressRows, statusRows] = await Promise.all([
      primaryFileIds.length > 0
        ? this.db
            .select({ bookFileId: readingProgress.bookFileId, percentage: readingProgress.percentage })
            .from(readingProgress)
            .where(and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, primaryFileIds)))
        : Promise.resolve([]),
      bookIds.length > 0
        ? this.db
            .select({
              bookId: userBookStatus.bookId,
              status: userBookStatus.status,
              source: userBookStatus.source,
              startedAt: userBookStatus.startedAt,
              finishedAt: userBookStatus.finishedAt,
              updatedAt: userBookStatus.updatedAt,
            })
            .from(userBookStatus)
            .where(and(eq(userBookStatus.userId, userId), inArray(userBookStatus.bookId, bookIds)))
        : Promise.resolve([]),
    ]);

    return { rows, authorRows, fileRows, genreRows, progressRows, statusRows, total: Number(total) };
  }

  async findCardsByBookIds(bookIds: number[], userId: number) {
    if (bookIds.length === 0) {
      return {
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      };
    }

    return this.findCards({
      where: inArray(books.id, bookIds),
      orderBy: [],
      limit: bookIds.length,
      offset: 0,
      userId,
    });
  }

  async findById(id: number) {
    const [book] = await this.db
      .select()
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, id))
      .limit(1);

    if (!book) return null;

    const [authorRows, genreRows, tagRows, fileRows, narratorRows] = await Promise.all([
      this.db
        .select({ id: authors.id, name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, id))
        .orderBy(bookAuthors.displayOrder),
      this.db.select({ name: genres.name }).from(bookGenres).innerJoin(genres, eq(genres.id, bookGenres.genreId)).where(eq(bookGenres.bookId, id)),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, id)),
      this.db
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
          createdAt: bookFiles.createdAt,
          durationSeconds: bookFiles.durationSeconds,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, id))
        .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id)),
      this.db
        .select({ id: narrators.id, name: narrators.name, sortName: narrators.sortName, displayOrder: bookNarrators.displayOrder })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(eq(bookNarrators.bookId, id))
        .orderBy(bookNarrators.displayOrder),
    ]);

    return { book, authorRows, genreRows, tagRows, fileRows, narratorRows };
  }

  async findCollectionsByBookId(bookId: number, userId: number): Promise<{ id: number; name: string }[]> {
    return this.db
      .select({ id: collections.id, name: collections.name })
      .from(collectionBooks)
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId)))
      .where(eq(collectionBooks.bookId, bookId))
      .orderBy(collections.name);
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

  async findProgressByBook(userId: number, bookId: number) {
    return this.db
      .select({
        fileId: bookFiles.id,
        cfi: readingProgress.cfi,
        pageNumber: readingProgress.pageNumber,
        percentage: readingProgress.percentage,
        updatedAt: readingProgress.updatedAt,
      })
      .from(bookFiles)
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async findKoboReadingState(userId: number, bookId: number) {
    const [row] = await this.db
      .select({
        createdAtKobo: koboReadingStates.createdAtKobo,
        lastModifiedKobo: koboReadingStates.lastModifiedKobo,
        priorityTimestamp: koboReadingStates.priorityTimestamp,
        currentBookmark: koboReadingStates.currentBookmark,
        statistics: koboReadingStates.statistics,
        statusInfo: koboReadingStates.statusInfo,
        progressSyncedAt: koboReadingStates.progressSyncedAt,
        updatedAt: koboReadingStates.updatedAt,
      })
      .from(koboReadingStates)
      .where(and(eq(koboReadingStates.userId, userId), eq(koboReadingStates.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async findKoboSnapshotState(userId: number, bookId: number) {
    const [row] = await this.db
      .select({
        snapshotId: koboLibrarySnapshots.id,
        snapshotUpdatedAt: koboLibrarySnapshots.updatedAt,
        synced: koboSnapshotBooks.synced,
        pendingDelete: koboSnapshotBooks.pendingDelete,
        isNew: koboSnapshotBooks.isNew,
        removedByDevice: koboSnapshotBooks.removedByDevice,
        fileHash: koboSnapshotBooks.fileHash,
        metadataHash: koboSnapshotBooks.metadataHash,
      })
      .from(koboLibrarySnapshots)
      .leftJoin(koboSnapshotBooks, and(eq(koboSnapshotBooks.snapshotId, koboLibrarySnapshots.id), eq(koboSnapshotBooks.bookId, bookId)))
      .where(eq(koboLibrarySnapshots.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async findKoboSyncCollectionNamesForBook(userId: number, bookId: number): Promise<string[]> {
    const rows = await this.db
      .select({ name: collections.name })
      .from(collectionBooks)
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId), eq(collections.syncToKobo, true)))
      .where(eq(collectionBooks.bookId, bookId));
    return rows.map((r) => r.name);
  }

  async searchAcrossLibraries(libraryIds: number[], q: string, limit: number) {
    if (libraryIds.length === 0) return [];

    const pattern = '%' + q + '%';

    const matchedAuthors = this.db
      .selectDistinct({ bookId: bookAuthors.bookId })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(sql`${authors.name} ILIKE ${pattern}`)
      .as('matched_authors');

    const rows = await this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        seriesName: bookMetadata.seriesName,
        libraryId: books.libraryId,
        libraryName: libraries.name,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(matchedAuthors, eq(matchedAuthors.bookId, books.id))
      .where(
        and(
          inArray(books.libraryId, libraryIds),
          or(sql`${bookMetadata.title} ILIKE ${pattern}`, sql`${bookMetadata.seriesName} ILIKE ${pattern}`, isNotNull(matchedAuthors.bookId)),
        ),
      )
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

    const formatRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: bookFiles.bookId, format: bookFiles.format })
            .from(bookFiles)
            .where(and(inArray(bookFiles.bookId, bookIds), inArray(bookFiles.format, [...SUPPORTED_BOOK_FORMATS])))
        : [];

    const formatsByBook = new Map<number, string[]>();
    for (const row of formatRows) {
      if (row.format) {
        const list = formatsByBook.get(row.bookId) ?? [];
        if (!list.includes(row.format)) list.push(row.format);
        formatsByBook.set(row.bookId, list);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      seriesName: r.seriesName,
      authors: authorsByBook.get(r.id) ?? [],
      libraryId: r.libraryId,
      libraryName: r.libraryName,
      formats: formatsByBook.get(r.id) ?? [],
    }));
  }

  async countWhere(where: SQL | undefined): Promise<number> {
    const [{ total }] = await this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where);
    return Number(total);
  }

  async findLibraryIdsByBookIds(bookIds: number[]): Promise<{ id: number; libraryId: number }[]> {
    if (bookIds.length === 0) return [];
    return this.db.select({ id: books.id, libraryId: books.libraryId }).from(books).where(inArray(books.id, bookIds));
  }

  async findRecommendationTitlesByBookIds(bookIds: number[]): Promise<{ id: number; title: string | null }[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({ id: books.id, title: bookMetadata.title })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(inArray(books.id, bookIds));
  }

  async findPatternMetadataByBookIds(bookIds: number[]): Promise<PatternMetadataRow[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows] = await Promise.all([
      this.db
        .select({
          bookId: books.id,
          title: bookMetadata.title,
          subtitle: bookMetadata.subtitle,
          publisher: bookMetadata.publisher,
          publishedYear: bookMetadata.publishedYear,
          language: bookMetadata.language,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          isbn13: bookMetadata.isbn13,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
    ]);

    const authorsByBookId = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBookId.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBookId.set(row.bookId, list);
    }

    return metaRows.map((row) => ({ ...row, authors: authorsByBookId.get(row.bookId) ?? [] }));
  }

  async findAllIds(): Promise<number[]> {
    const rows = await this.db.select({ id: books.id }).from(books);
    return rows.map((r) => r.id);
  }

  async findPrimaryFile(bookId: number): Promise<{ absolutePath: string; format: string | null } | null> {
    const [row] = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  async findPrimaryFilesByBookIds(
    bookIds: number[],
  ): Promise<{ bookId: number; absolutePath: string; format: string | null; sizeBytes: number | null }[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({ bookId: books.id, absolutePath: bookFiles.absolutePath, format: bookFiles.format, sizeBytes: bookFiles.sizeBytes })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(inArray(books.id, bookIds))
      .orderBy(asc(books.id));
  }

  async findAllFilesByBookIds(
    bookIds: number[],
  ): Promise<{ bookId: number; absolutePath: string; format: string | null; sizeBytes: number | null; sortOrder: number }[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        bookId: bookFiles.bookId,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(inArray(bookFiles.bookId, bookIds))
      .orderBy(asc(bookFiles.bookId), asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async deleteByIds(bookIds: number[]): Promise<void> {
    await this.db.delete(books).where(inArray(books.id, bookIds));
  }

  async updateMetadataFields(
    bookId: number,
    fields: Partial<typeof bookMetadata.$inferInsert>,
    executor: MetadataUpdateExecutor = this.db,
  ): Promise<void> {
    await executor.update(bookMetadata).set(fields).where(eq(bookMetadata.bookId, bookId));
  }

  async upsertProgress(
    userId: number,
    fileId: number,
    cfi: string | null,
    pageNumber: number | null,
    percentage: number,
    positionSeconds?: number | null,
  ) {
    const now = new Date();
    await this.db
      .insert(readingProgress)
      .values({ userId, bookFileId: fileId, cfi, pageNumber, percentage, positionSeconds: positionSeconds ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: [readingProgress.bookFileId, readingProgress.userId],
        set: { cfi, pageNumber, percentage, positionSeconds: positionSeconds ?? null, updatedAt: now },
      });
  }

  async findAudioProgress(userId: number, bookId: number) {
    const [row] = await this.db
      .select()
      .from(audiobookProgress)
      .where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async upsertAudioProgress(userId: number, bookId: number, currentFileId: number, positionSeconds: number, percentage: number) {
    const now = new Date();
    const [row] = await this.db
      .insert(audiobookProgress)
      .values({ userId, bookId, currentFileId, positionSeconds, percentage, updatedAt: now })
      .onConflictDoUpdate({
        target: [audiobookProgress.userId, audiobookProgress.bookId],
        set: { currentFileId, positionSeconds, percentage, updatedAt: now },
      })
      .returning();
    return row;
  }
}
