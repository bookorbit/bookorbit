import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { StatisticsDateRange, StatisticsGranularity } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookFiles, bookGenres, bookMetadata, books, genres, authors, userLibraryAccess } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class StatisticsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[] | null> {
    if (isSuperuser) return null;
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  private intersectLibraryIds(accessible: number[] | null, requested: number[] | undefined): number[] | null {
    if (!requested || requested.length === 0) return accessible;
    if (accessible === null) return requested;
    const set = new Set(accessible);
    return requested.filter((id) => set.has(id));
  }

  private libraryFilter(libraryIds: number[] | null) {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return inArray(books.libraryId, libraryIds);
  }

  async formatDistribution(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    return this.db
      .select({
        format: bookFiles.format,
        count: sql<number>`count(distinct ${bookFiles.bookId})::int`,
      })
      .from(bookFiles)
      .innerJoin(books, eq(bookFiles.bookId, books.id))
      .where(and(isNotNull(bookFiles.format), filter))
      .groupBy(bookFiles.format)
      .orderBy(desc(sql<number>`count(distinct ${bookFiles.bookId})`));
  }

  async languageDistribution(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const items = await this.db
      .select({
        language: bookMetadata.language,
        count: sql<number>`count(*)::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(isNotNull(bookMetadata.language), filter))
      .groupBy(bookMetadata.language)
      .orderBy(desc(sql<number>`count(*)`));

    const [{ unknownCount }] = await this.db
      .select({ unknownCount: sql<number>`count(*)::int` })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(isNull(bookMetadata.language), filter));

    return { items, unknownCount };
  }

  async booksAddedOverTime(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    granularity: StatisticsGranularity = 'monthly',
    range: StatisticsDateRange = 'all-time',
  ) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const rangeFilter =
      range === 'last-year'
        ? gte(books.addedAt, sql`now() - interval '1 year'`)
        : range === 'last-5-years'
          ? gte(books.addedAt, sql`now() - interval '5 years'`)
          : undefined;

    if (granularity === 'yearly') {
      return this.db
        .select({
          year: sql<number>`extract(year from ${books.addedAt})::int`,
          month: sql<number>`0`,
          count: sql<number>`count(*)::int`,
        })
        .from(books)
        .where(and(libFilter, rangeFilter))
        .groupBy(sql`extract(year from ${books.addedAt})`)
        .orderBy(sql`extract(year from ${books.addedAt})`);
    }

    return this.db
      .select({
        year: sql<number>`extract(year from ${books.addedAt})::int`,
        month: sql<number>`extract(month from ${books.addedAt})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(books)
      .where(and(libFilter, rangeFilter))
      .groupBy(sql`extract(year from ${books.addedAt})`, sql`extract(month from ${books.addedAt})`)
      .orderBy(sql`extract(year from ${books.addedAt})`, sql`extract(month from ${books.addedAt})`);
  }

  async storageByFormat(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    return this.db
      .select({
        format: bookFiles.format,
        sizeBytes: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint`,
      })
      .from(bookFiles)
      .innerJoin(books, eq(bookFiles.bookId, books.id))
      .where(and(isNotNull(bookFiles.format), isNotNull(bookFiles.sizeBytes), filter))
      .groupBy(bookFiles.format)
      .orderBy(desc(sql<number>`sum(${bookFiles.sizeBytes})`));
  }

  async publicationDecade(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const items = await this.db
      .select({
        decade: sql<number>`(floor(${bookMetadata.publishedYear} / 10) * 10)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(isNotNull(bookMetadata.publishedYear), filter))
      .groupBy(sql`floor(${bookMetadata.publishedYear} / 10) * 10`)
      .orderBy(sql`floor(${bookMetadata.publishedYear} / 10) * 10`);

    const [{ unknownCount }] = await this.db
      .select({ unknownCount: sql<number>`count(*)::int` })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(isNull(bookMetadata.publishedYear), filter));

    return { items, unknownCount };
  }

  async topAuthors(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    return this.db
      .select({
        name: authors.name,
        count: sql<number>`count(distinct ${bookAuthors.bookId})::int`,
      })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(filter)
      .groupBy(authors.name)
      .orderBy(desc(sql<number>`count(distinct ${bookAuthors.bookId})`));
  }

  async metadataCompleteness(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        hasTitle: sql<number>`count(${bookMetadata.title})::int`,
        hasCover: sql<number>`count(${bookMetadata.coverSource})::int`,
        hasDescription: sql<number>`count(${bookMetadata.description})::int`,
        hasPublisher: sql<number>`count(${bookMetadata.publisher})::int`,
        hasYear: sql<number>`count(${bookMetadata.publishedYear})::int`,
        hasLanguage: sql<number>`count(${bookMetadata.language})::int`,
        hasPageCount: sql<number>`count(${bookMetadata.pageCount})::int`,
        hasRating: sql<number>`count(${bookMetadata.rating})::int`,
        hasSeries: sql<number>`count(${bookMetadata.seriesName})::int`,
        hasIsbn: sql<number>`count(case when ${bookMetadata.isbn13} is not null or ${bookMetadata.isbn10} is not null then 1 end)::int`,
        hasAuthor: sql<number>`count(distinct ba.book_id)::int`,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(sql`(select distinct book_id from book_authors) ba`, sql`ba.book_id = ${books.id}`)
      .where(filter);

    return row;
  }

  async genreDistribution(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const items = await this.db
      .select({
        genre: genres.name,
        count: sql<number>`count(distinct ${bookGenres.bookId})::int`,
      })
      .from(bookGenres)
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .innerJoin(books, eq(books.id, bookGenres.bookId))
      .where(filter)
      .groupBy(genres.name)
      .orderBy(desc(sql<number>`count(distinct ${bookGenres.bookId})`));

    const [{ unknownCount }] = await this.db
      .select({ unknownCount: sql<number>`count(distinct ${books.id})::int` })
      .from(books)
      .leftJoin(bookGenres, eq(bookGenres.bookId, books.id))
      .where(and(isNull(bookGenres.genreId), filter));

    return { items, unknownCount };
  }

  async getSummary(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const [[booksRow], [authorsRow], [seriesRow], [publishersRow], [storageRow], [genresRow], [languagesRow], [pubRangeRow], [thisYearRow]] =
      await Promise.all([
        this.db
          .select({ count: sql<number>`count(distinct ${books.id})::int` })
          .from(books)
          .where(filter),
        this.db
          .select({ count: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
          .from(bookAuthors)
          .innerJoin(books, eq(books.id, bookAuthors.bookId))
          .where(filter),
        this.db
          .select({ count: sql<number>`count(distinct ${bookMetadata.seriesName})::int` })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(isNotNull(bookMetadata.seriesName), filter)),
        this.db
          .select({ count: sql<number>`count(distinct ${bookMetadata.publisher})::int` })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(isNotNull(bookMetadata.publisher), filter)),
        this.db
          .select({ total: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint` })
          .from(bookFiles)
          .innerJoin(books, eq(books.id, bookFiles.bookId))
          .where(filter),
        this.db
          .select({ count: sql<number>`count(distinct ${genres.id})::int` })
          .from(genres)
          .innerJoin(bookGenres, eq(bookGenres.genreId, genres.id))
          .innerJoin(books, eq(books.id, bookGenres.bookId))
          .where(filter),
        this.db
          .select({ count: sql<number>`count(distinct ${bookMetadata.language})::int` })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(isNotNull(bookMetadata.language), filter)),
        this.db
          .select({
            minYear: sql<number | null>`min(${bookMetadata.publishedYear})`,
            maxYear: sql<number | null>`max(${bookMetadata.publishedYear})`,
          })
          .from(bookMetadata)
          .innerJoin(books, eq(books.id, bookMetadata.bookId))
          .where(and(isNotNull(bookMetadata.publishedYear), filter)),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(books)
          .where(and(gte(books.addedAt, sql`date_trunc('year', current_date)`), filter)),
      ]);

    return {
      totalBooks: booksRow.count,
      totalAuthors: authorsRow.count,
      totalSeries: seriesRow.count,
      totalPublishers: publishersRow.count,
      totalStorageBytes: storageRow.total,
      totalGenres: genresRow.count,
      totalLanguages: languagesRow.count,
      publicationYearMin: pubRangeRow.minYear,
      publicationYearMax: pubRangeRow.maxYear,
      booksAddedThisYear: thisYearRow.count,
    };
  }
}
