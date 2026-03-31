import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq, gt, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookGenres, bookMetadata, bookTags } from '../../db/schema';
import type { ScoreData } from './metadata-score.scorer';

type Db = NodePgDatabase<typeof schema>;

const METADATA_SCORE_BASE_SELECT = {
  title: bookMetadata.title,
  subtitle: bookMetadata.subtitle,
  description: bookMetadata.description,
  isbn10: bookMetadata.isbn10,
  isbn13: bookMetadata.isbn13,
  publisher: bookMetadata.publisher,
  publishedYear: bookMetadata.publishedYear,
  language: bookMetadata.language,
  pageCount: bookMetadata.pageCount,
  seriesName: bookMetadata.seriesName,
  seriesIndex: bookMetadata.seriesIndex,
  rating: bookMetadata.rating,
  coverSource: bookMetadata.coverSource,
  googleBooksId: bookMetadata.googleBooksId,
  goodreadsId: bookMetadata.goodreadsId,
  amazonId: bookMetadata.amazonId,
  hardcoverId: bookMetadata.hardcoverId,
  openLibraryId: bookMetadata.openLibraryId,
  itunesId: bookMetadata.itunesId,
} as const;

export type ScorePage = {
  rows: { bookId: number; data: ScoreData }[];
  nextCursor: number | null;
};

@Injectable()
export class MetadataScoreRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async loadScoreData(bookId: number): Promise<ScoreData | null> {
    const [metaRow] = await this.db.select(METADATA_SCORE_BASE_SELECT).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    if (!metaRow) return null;

    const [[{ authorCount }], [{ genreCount }], [{ tagCount }]] = await Promise.all([
      this.db.select({ authorCount: count() }).from(bookAuthors).where(eq(bookAuthors.bookId, bookId)),
      this.db.select({ genreCount: count() }).from(bookGenres).where(eq(bookGenres.bookId, bookId)),
      this.db.select({ tagCount: count() }).from(bookTags).where(eq(bookTags.bookId, bookId)),
    ]);

    return {
      ...metaRow,
      authorCount: Number(authorCount),
      genreCount: Number(genreCount),
      tagCount: Number(tagCount),
    };
  }

  async loadScoreDataPage(afterBookId: number | null, pageSize: number): Promise<ScorePage> {
    const selectShape = { bookId: bookMetadata.bookId, ...METADATA_SCORE_BASE_SELECT };
    const metaRows =
      afterBookId === null
        ? await this.db.select(selectShape).from(bookMetadata).orderBy(asc(bookMetadata.bookId)).limit(pageSize)
        : await this.db
            .select(selectShape)
            .from(bookMetadata)
            .where(gt(bookMetadata.bookId, afterBookId))
            .orderBy(asc(bookMetadata.bookId))
            .limit(pageSize);

    if (metaRows.length === 0) {
      return { rows: [], nextCursor: null };
    }

    const bookIds = metaRows.map((row) => row.bookId);
    const [authorCounts, genreCounts, tagCounts] = await Promise.all([
      this.db
        .select({ bookId: bookAuthors.bookId, cnt: count() })
        .from(bookAuthors)
        .where(inArray(bookAuthors.bookId, bookIds))
        .groupBy(bookAuthors.bookId),
      this.db
        .select({ bookId: bookGenres.bookId, cnt: count() })
        .from(bookGenres)
        .where(inArray(bookGenres.bookId, bookIds))
        .groupBy(bookGenres.bookId),
      this.db.select({ bookId: bookTags.bookId, cnt: count() }).from(bookTags).where(inArray(bookTags.bookId, bookIds)).groupBy(bookTags.bookId),
    ]);

    const authorMap = new Map(authorCounts.map((row) => [row.bookId, Number(row.cnt)]));
    const genreMap = new Map(genreCounts.map((row) => [row.bookId, Number(row.cnt)]));
    const tagMap = new Map(tagCounts.map((row) => [row.bookId, Number(row.cnt)]));

    const rows = metaRows.map((row) => ({
      bookId: row.bookId,
      data: {
        ...row,
        authorCount: authorMap.get(row.bookId) ?? 0,
        genreCount: genreMap.get(row.bookId) ?? 0,
        tagCount: tagMap.get(row.bookId) ?? 0,
      },
    }));

    return {
      rows,
      nextCursor: rows[rows.length - 1]?.bookId ?? null,
    };
  }

  async updateMetadataScore(bookId: number, score: number): Promise<void> {
    await this.db.update(bookMetadata).set({ metadataScore: score }).where(eq(bookMetadata.bookId, bookId));
  }
}
