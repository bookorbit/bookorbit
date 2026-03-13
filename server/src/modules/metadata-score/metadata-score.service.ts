import { Inject, Injectable, Logger } from '@nestjs/common';
import { count, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { type MetadataScoreWeights } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookGenres, bookMetadata, bookTags } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';

type Db = NodePgDatabase<typeof schema>;

type ScoreData = {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  rating: number | null;
  coverSource: string | null;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  itunesId: string | null;
  authorCount: number;
  genreCount: number;
  tagCount: number;
};

@Injectable()
export class MetadataScoreService {
  private readonly logger = new Logger(MetadataScoreService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly appSettings: AppSettingsService,
  ) {}

  async getWeights(): Promise<MetadataScoreWeights> {
    return this.appSettings.getMetadataScoreWeights();
  }

  async updateWeights(weights: MetadataScoreWeights): Promise<MetadataScoreWeights> {
    await this.appSettings.setMetadataScoreWeights(weights);
    this.recalculateAll().catch((err: Error) => this.logger.warn(`Recalculate-all after weight update failed: ${err.message}`));
    return weights;
  }

  async calculateAndSave(bookId: number): Promise<void> {
    const [data, weights] = await Promise.all([this.loadScoreData(bookId), this.appSettings.getMetadataScoreWeights()]);
    if (!data) return;
    const score = this.compute(data, weights);
    await this.db.update(bookMetadata).set({ metadataScore: score }).where(eq(bookMetadata.bookId, bookId));
  }

  async recalculateAll(): Promise<{ processed: number }> {
    const weights = await this.appSettings.getMetadataScoreWeights();
    const allRows = await this.loadAllScoreData();
    const BATCH = 200;
    let processed = 0;

    for (let i = 0; i < allRows.length; i += BATCH) {
      const batch = allRows.slice(i, i + BATCH);
      await Promise.all(
        batch.map(({ bookId, data }) => {
          const score = this.compute(data, weights);
          return this.db
            .update(bookMetadata)
            .set({ metadataScore: score })
            .where(eq(bookMetadata.bookId, bookId))
            .catch((err: Error) => this.logger.warn(`Score recalculation failed for book ${bookId}: ${err.message}`));
        }),
      );
      processed += batch.length;
    }

    this.logger.log(`Metadata score recalculation complete: ${processed} books processed`);
    return { processed };
  }

  private async loadAllScoreData(): Promise<{ bookId: number; data: ScoreData }[]> {
    const metaRows = await this.db
      .select({
        bookId: bookMetadata.bookId,
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
      })
      .from(bookMetadata);

    if (metaRows.length === 0) return [];

    const bookIds = metaRows.map((r) => r.bookId);

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

    const authorMap = new Map(authorCounts.map((r) => [r.bookId, Number(r.cnt)]));
    const genreMap = new Map(genreCounts.map((r) => [r.bookId, Number(r.cnt)]));
    const tagMap = new Map(tagCounts.map((r) => [r.bookId, Number(r.cnt)]));

    return metaRows.map((row) => ({
      bookId: row.bookId,
      data: {
        ...row,
        authorCount: authorMap.get(row.bookId) ?? 0,
        genreCount: genreMap.get(row.bookId) ?? 0,
        tagCount: tagMap.get(row.bookId) ?? 0,
      },
    }));
  }

  private async loadScoreData(bookId: number): Promise<ScoreData | null> {
    const [metaRow] = await this.db
      .select({
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
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

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

  private compute(data: ScoreData, weights: MetadataScoreWeights): number {
    const earned =
      this.scoreString(data.title, weights.title) +
      this.scoreString(data.subtitle, weights.subtitle) +
      this.scoreString(data.description, weights.description) +
      this.scoreString(data.coverSource, weights.coverSource) +
      this.scoreCount(data.authorCount, weights.authors) +
      this.scoreCount(data.genreCount, weights.genres) +
      this.scoreCount(data.tagCount, weights.tags) +
      this.scoreString(data.isbn13, weights.isbn13) +
      this.scoreString(data.isbn10, weights.isbn10) +
      this.scoreString(data.publisher, weights.publisher) +
      this.scorePositiveNumber(data.publishedYear, weights.publishedYear) +
      this.scoreString(data.language, weights.language) +
      this.scorePositiveNumber(data.pageCount, weights.pageCount) +
      this.scorePositiveNumber(data.rating, weights.rating) +
      this.scoreString(data.seriesName, weights.seriesName) +
      this.scorePositiveNumber(data.seriesIndex, weights.seriesIndex) +
      this.scoreString(data.googleBooksId, weights.googleBooksId) +
      this.scoreString(data.goodreadsId, weights.goodreadsId) +
      this.scoreString(data.amazonId, weights.amazonId) +
      this.scoreString(data.hardcoverId, weights.hardcoverId) +
      this.scoreString(data.openLibraryId, weights.openLibraryId) +
      this.scoreString(data.itunesId, weights.itunesId);

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (total === 0) return 0;
    return Math.floor((earned / total) * 100);
  }

  private scoreString(value: string | null | undefined, weight: number): number {
    return value != null && value.trim().length > 0 ? weight : 0;
  }

  private scoreCount(count: number, weight: number): number {
    return count > 0 ? weight : 0;
  }

  private scorePositiveNumber(value: number | null | undefined, weight: number): number {
    return value != null && value > 0 ? weight : 0;
  }
}
