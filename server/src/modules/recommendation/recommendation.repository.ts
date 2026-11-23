import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, ne, and, isNotNull, sql, asc, desc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { isAudioFormat, isComicFormat } from '@bookorbit/types';
import { DB } from '../../db';
import { bookLastReadSql } from '../../db/book-last-read';
import { workKeySql } from '../../db/book-work-key';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, bookTags, books, genres, libraries, tags } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { seriesIndexOrderBy } from '../../common/utils/series-index-sql.utils';
import { foldWorks, WORK_FOLD_OVERFETCH } from './recommendation-work-fold';

type Db = NodePgDatabase<typeof schema>;

/** The reader whose last-read edition a folded shelf shows, and the book the shelf sits on. */
export interface ShelfViewer {
  userId: number;
  openBookId: number;
}
const ANN_CANDIDATE_FETCH_LIMIT = 100;
const SERIES_BOOKS_LIMIT = 50;
const AUTHOR_BOOKS_LIMIT = 25;

export interface SeriesBookRow {
  bookId: number;
  title: string | null;
  coverAspectRatio: string;
  updatedAt: Date | null;
  seriesIndex: string | null;
  coverSource: string | null;
  authorNames: string[];
  isAudiobook: boolean;
  isComic: boolean;
}

export interface AuthorBookRow {
  bookId: number;
  title: string | null;
  coverAspectRatio: string;
  updatedAt: Date | null;
  coverSource: string | null;
  authorNames: string[];
  isAudiobook: boolean;
  isComic: boolean;
}

export interface AnnCandidate {
  bookId: number;
  /** Editions of one work share it, so the list can show the work once. */
  workKey: string;
  cosineSim: number;
  seriesId: number | null;
  seriesName: string | null;
  rating: number | null;
}

export interface CandidateMetadata {
  bookId: number;
  authorNames: string[];
  genreTagNames: string[];
}

export interface TargetBookData {
  embedding: number[] | null;
  seriesId: number | null;
  seriesName: string | null;
  rating: number | null;
  authorNames: string[];
  genreTagNames: string[];
}

export interface SeriesIdentity {
  id: number;
  name: string | null;
}

@Injectable()
export class RecommendationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getTargetBookData(bookId: number): Promise<TargetBookData | null> {
    const [meta] = await this.db
      .select({
        embedding: bookMetadata.embedding,
        seriesId: bookMetadata.seriesId,
        seriesName: bookMetadata.seriesName,
        rating: bookMetadata.rating,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    if (!meta) return null;

    const [candidateMetadata] = await this.getCandidateMetadata([bookId]);

    return {
      embedding: meta.embedding,
      seriesId: meta.seriesId,
      seriesName: meta.seriesName,
      rating: meta.rating,
      authorNames: candidateMetadata?.authorNames ?? [],
      genreTagNames: candidateMetadata?.genreTagNames ?? [],
    };
  }

  async getSeriesIdentity(bookId: number): Promise<SeriesIdentity | null> {
    const [row] = await this.db
      .select({ seriesId: bookMetadata.seriesId, seriesName: bookMetadata.seriesName })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    if (row?.seriesId == null) return null;
    return { id: row.seriesId, name: row.seriesName?.trim() || null };
  }

  async findAnnCandidates(
    embedding: number[],
    targetBookId: number,
    libraryIds: number[],
    contentFilters?: ContentFilterRules,
  ): Promise<AnnCandidate[]> {
    if (libraryIds.length === 0 || embedding.length === 0 || embedding.some((v) => !Number.isFinite(v))) return [];

    const vecStr = `[${embedding.join(',')}]`;
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({
        bookId: bookMetadata.bookId,
        workKey: sql<string>`${workKeySql(books.id)}`,
        cosineSim: sql<number>`(1 - (${bookMetadata.embedding} <=> ${vecStr}::vector))::float`,
        seriesId: bookMetadata.seriesId,
        seriesName: bookMetadata.seriesName,
        rating: bookMetadata.rating,
      })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(
        and(
          inArray(books.libraryId, libraryIds),
          ne(bookMetadata.bookId, targetBookId),
          sql`NOT EXISTS (
            SELECT 1 FROM book_links target_link
            INNER JOIN book_links sibling ON sibling.group_id = target_link.group_id
            WHERE target_link.book_id = ${targetBookId} AND sibling.book_id = ${books.id}
          )`,
          isNotNull(bookMetadata.embedding),
          ...filterClauses,
        ),
      )
      .orderBy(sql`${bookMetadata.embedding} <=> ${vecStr}::vector`)
      .limit(ANN_CANDIDATE_FETCH_LIMIT);
  }

  async getCandidateMetadata(bookIds: number[]): Promise<CandidateMetadata[]> {
    if (bookIds.length === 0) return [];

    const [authorRows, genreRows, tagRows] = await Promise.all([
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds)),
      this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(inArray(bookGenres.bookId, bookIds)),
      this.db
        .select({ bookId: bookTags.bookId, name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(inArray(bookTags.bookId, bookIds)),
    ]);

    const authorsByBook = this.groupNamesByBook(authorRows);
    const genreTagsByBook = this.groupNamesByBook([...genreRows, ...tagRows]);

    return bookIds.map((id) => ({
      bookId: id,
      authorNames: authorsByBook.get(id) ?? [],
      genreTagNames: genreTagsByBook.get(id) ?? [],
    }));
  }

  /**
   * Series members, one per work when `viewer` is given: the open book stands for its own editions,
   * which the client then drops along with it, and every other work shows the edition the viewer
   * would see in a library list.
   */
  async findSeriesBooks(seriesId: number, libraryIds: number[], contentFilters?: ContentFilterRules, viewer?: ShelfViewer): Promise<SeriesBookRow[]> {
    if (libraryIds.length === 0) return [];

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const fetched = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        coverAspectRatio: libraries.coverAspectRatio,
        updatedAt: books.updatedAt,
        seriesIndex: bookMetadata.seriesIndex,
        coverSource: bookMetadata.coverSource,
        primaryFormat: bookFiles.format,
        ...this.workFoldFields(viewer),
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(inArray(books.libraryId, libraryIds), eq(bookMetadata.seriesId, seriesId), ...filterClauses))
      .orderBy(...seriesIndexOrderBy(bookMetadata.seriesIndex, 'ASC'), asc(bookMetadata.title), asc(books.id))
      .limit(viewer ? SERIES_BOOKS_LIMIT * WORK_FOLD_OVERFETCH : SERIES_BOOKS_LIMIT);
    const rows = viewer ? foldWorks(fetched, SERIES_BOOKS_LIMIT, viewer.openBookId) : fetched;

    const bookIds = rows.map((r) => r.bookId);
    const authorRows =
      bookIds.length === 0
        ? []
        : await this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds));

    const authorsByBook = this.groupNamesByBook(authorRows);

    return rows.map((r) => ({
      bookId: r.bookId,
      title: r.title,
      coverAspectRatio: r.coverAspectRatio,
      updatedAt: r.updatedAt ?? null,
      seriesIndex: r.seriesIndex,
      coverSource: r.coverSource,
      authorNames: authorsByBook.get(r.bookId) ?? [],
      isAudiobook: r.primaryFormat != null ? isAudioFormat(r.primaryFormat) : false,
      isComic: r.primaryFormat != null ? isComicFormat(r.primaryFormat) : false,
    }));
  }

  /**
   * Other books by the open book's authors. Its own editions never count as other books; with
   * `viewer`, every other work shows once, as the edition the viewer would see in a library list.
   */
  async findAuthorBooks(bookId: number, libraryIds: number[], contentFilters?: ContentFilterRules, viewer?: ShelfViewer): Promise<AuthorBookRow[]> {
    if (libraryIds.length === 0) return [];

    const authorIds = this.db.select({ authorId: bookAuthors.authorId }).from(bookAuthors).where(eq(bookAuthors.bookId, bookId));
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const fetched = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        coverAspectRatio: libraries.coverAspectRatio,
        updatedAt: books.updatedAt,
        coverSource: bookMetadata.coverSource,
        sharedAuthors: sql<number>`count(*)::int`.as('shared_authors'),
        primaryFormat: bookFiles.format,
        ...this.workFoldFields(viewer),
      })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(
        and(
          inArray(bookAuthors.authorId, authorIds),
          inArray(books.libraryId, libraryIds),
          ne(books.id, bookId),
          sql`NOT EXISTS (
            SELECT 1 FROM book_links open_link
            INNER JOIN book_links sibling ON sibling.group_id = open_link.group_id
            WHERE open_link.book_id = ${bookId} AND sibling.book_id = ${books.id}
          )`,
          ...filterClauses,
        ),
      )
      .groupBy(books.id, books.updatedAt, libraries.coverAspectRatio, bookMetadata.title, bookMetadata.coverSource, bookFiles.format)
      .orderBy(desc(sql`shared_authors`), asc(bookMetadata.title), asc(books.id))
      .limit(viewer ? AUTHOR_BOOKS_LIMIT * WORK_FOLD_OVERFETCH : AUTHOR_BOOKS_LIMIT);
    const rows = viewer ? foldWorks(fetched, AUTHOR_BOOKS_LIMIT) : fetched;

    const bookIds = rows.map((r) => r.bookId);
    const authorRows =
      bookIds.length === 0
        ? []
        : await this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds));

    const authorsByBook = this.groupNamesByBook(authorRows);

    return rows.map((r) => ({
      bookId: r.bookId,
      title: r.title,
      coverAspectRatio: r.coverAspectRatio,
      updatedAt: r.updatedAt ?? null,
      coverSource: r.coverSource,
      authorNames: authorsByBook.get(r.bookId) ?? [],
      isAudiobook: r.primaryFormat != null ? isAudioFormat(r.primaryFormat) : false,
      isComic: r.primaryFormat != null ? isComicFormat(r.primaryFormat) : false,
    }));
  }

  /** What `foldWorks` needs per row, selected only when the shelf folds. */
  private workFoldFields(viewer: ShelfViewer | undefined) {
    if (!viewer)
      return {
        workKey: sql<string | null>`null`,
        status: sql<string | null>`null`,
        lastReadAt: sql<null>`null`,
        leadBookId: sql<number | null>`null`,
      };
    return {
      workKey: workKeySql(books.id),
      status: sql<string | null>`${books.status}`,
      lastReadAt: bookLastReadSql(books.id, viewer.userId),
      leadBookId: sql<
        number | null
      >`(SELECT g.lead_book_id FROM book_links bl INNER JOIN book_link_groups g ON g.id = bl.group_id WHERE bl.book_id = ${books.id})`,
    };
  }

  private groupNamesByBook(rows: Array<{ bookId: number; name: string }>): Map<number, string[]> {
    const grouped = new Map<number, string[]>();
    for (const row of rows) {
      const names = grouped.get(row.bookId) ?? [];
      names.push(row.name);
      grouped.set(row.bookId, names);
    }
    return grouped;
  }
}
