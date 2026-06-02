import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, ne, and, isNotNull, sql, asc, desc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, bookTags, books, genres, tags } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;
const ANN_CANDIDATE_FETCH_LIMIT = 100;
const SERIES_BOOKS_LIMIT = 50;
const AUTHOR_BOOKS_LIMIT = 25;

export interface SeriesBookRow {
  bookId: number;
  title: string | null;
  seriesIndex: number | null;
  coverSource: string | null;
  authorNames: string[];
  isAudiobook: boolean;
}

export interface AuthorBookRow {
  bookId: number;
  title: string | null;
  coverSource: string | null;
  authorNames: string[];
  isAudiobook: boolean;
}

export interface AnnCandidate {
  bookId: number;
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
        cosineSim: sql<number>`(1 - (${bookMetadata.embedding} <=> ${vecStr}::vector))::float`,
        seriesId: bookMetadata.seriesId,
        seriesName: bookMetadata.seriesName,
        rating: bookMetadata.rating,
      })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(inArray(books.libraryId, libraryIds), ne(bookMetadata.bookId, targetBookId), isNotNull(bookMetadata.embedding), ...filterClauses))
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

  async findSeriesBooks(seriesId: number, libraryIds: number[], contentFilters?: ContentFilterRules): Promise<SeriesBookRow[]> {
    if (libraryIds.length === 0) return [];

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        seriesIndex: bookMetadata.seriesIndex,
        coverSource: bookMetadata.coverSource,
        primaryFormat: bookFiles.format,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(inArray(books.libraryId, libraryIds), eq(bookMetadata.seriesId, seriesId), ...filterClauses))
      .orderBy(sql`${bookMetadata.seriesIndex} ASC NULLS LAST`, asc(bookMetadata.title), asc(books.id))
      .limit(SERIES_BOOKS_LIMIT);

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
      seriesIndex: r.seriesIndex,
      coverSource: r.coverSource,
      authorNames: authorsByBook.get(r.bookId) ?? [],
      isAudiobook: r.primaryFormat != null ? isAudioFormat(r.primaryFormat) : false,
    }));
  }

  async findAuthorBooks(bookId: number, libraryIds: number[], contentFilters?: ContentFilterRules): Promise<AuthorBookRow[]> {
    if (libraryIds.length === 0) return [];

    const authorIds = this.db.select({ authorId: bookAuthors.authorId }).from(bookAuthors).where(eq(bookAuthors.bookId, bookId));
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        coverSource: bookMetadata.coverSource,
        sharedAuthors: sql<number>`count(*)::int`.as('shared_authors'),
        primaryFormat: bookFiles.format,
      })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(inArray(bookAuthors.authorId, authorIds), inArray(books.libraryId, libraryIds), ne(books.id, bookId), ...filterClauses))
      .groupBy(books.id, bookMetadata.title, bookMetadata.coverSource, bookFiles.format)
      .orderBy(desc(sql`shared_authors`), asc(bookMetadata.title), asc(books.id))
      .limit(AUTHOR_BOOKS_LIMIT);

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
      coverSource: r.coverSource,
      authorNames: authorsByBook.get(r.bookId) ?? [],
      isAudiobook: r.primaryFormat != null ? isAudioFormat(r.primaryFormat) : false,
    }));
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
