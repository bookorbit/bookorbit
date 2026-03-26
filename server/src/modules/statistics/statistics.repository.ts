import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ChordDiagramData, StatisticsDateRange, StatisticsGranularity } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookGenres, bookMetadata, books, genres, libraries, userLibraryAccess } from '../../db/schema';

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

  async metadataScoreDistribution(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const bucketExpr = sql`(least(floor(${bookMetadata.metadataScore} / 10.0), 9) * 10)`;

    const [bins, [unknown], [percentiles]] = await Promise.all([
      this.db
        .select({
          minScore: sql<number>`${bucketExpr}::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(isNotNull(bookMetadata.metadataScore), filter))
        .groupBy(bucketExpr)
        .orderBy(bucketExpr),
      this.db
        .select({
          unknownCount: sql<number>`count(*)::int`,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(isNull(bookMetadata.metadataScore), filter)),
      this.db
        .select({
          totalCount: sql<number>`count(*)::int`,
          percentile25: sql<number | null>`percentile_cont(0.25) within group (order by ${bookMetadata.metadataScore})::float`,
          percentile50: sql<number | null>`percentile_cont(0.5) within group (order by ${bookMetadata.metadataScore})::float`,
          percentile75: sql<number | null>`percentile_cont(0.75) within group (order by ${bookMetadata.metadataScore})::float`,
          percentile90: sql<number | null>`percentile_cont(0.9) within group (order by ${bookMetadata.metadataScore})::float`,
        })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(isNotNull(bookMetadata.metadataScore), filter)),
    ]);

    return {
      bins,
      unknownCount: unknown?.unknownCount ?? 0,
      totalCount: percentiles?.totalCount ?? 0,
      percentile25: percentiles?.percentile25 ?? null,
      percentile50: percentiles?.percentile50 ?? null,
      percentile75: percentiles?.percentile75 ?? null,
      percentile90: percentiles?.percentile90 ?? null,
    };
  }

  async libraryMetadataCompleteness(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    return this.db
      .select({
        libraryId: books.libraryId,
        libraryName: libraries.name,
        total: sql<number>`count(*)::int`,
        hasTitle: sql<number>`count(${bookMetadata.title})::int`,
        hasCover: sql<number>`count(${bookMetadata.coverSource})::int`,
        hasAuthor: sql<number>`count(distinct ba.book_id)::int`,
        hasGenre: sql<number>`count(distinct bg.book_id)::int`,
        hasTag: sql<number>`count(distinct bt.book_id)::int`,
        hasDescription: sql<number>`count(${bookMetadata.description})::int`,
        hasPublisher: sql<number>`count(${bookMetadata.publisher})::int`,
        hasYear: sql<number>`count(${bookMetadata.publishedYear})::int`,
        hasLanguage: sql<number>`count(${bookMetadata.language})::int`,
        hasPageCount: sql<number>`count(${bookMetadata.pageCount})::int`,
        hasRating: sql<number>`count(${bookMetadata.rating})::int`,
        hasSeries: sql<number>`count(${bookMetadata.seriesName})::int`,
        hasIsbn: sql<number>`count(case when ${bookMetadata.isbn13} is not null or ${bookMetadata.isbn10} is not null then 1 end)::int`,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(sql`(select distinct book_id from book_authors) ba`, sql`ba.book_id = ${books.id}`)
      .leftJoin(sql`(select distinct book_id from book_genres) bg`, sql`bg.book_id = ${books.id}`)
      .leftJoin(sql`(select distinct book_id from book_tags) bt`, sql`bt.book_id = ${books.id}`)
      .where(filter)
      .groupBy(books.libraryId, libraries.name)
      .orderBy(libraries.name);
  }

  async formatShareOverTime(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const yearExpr = sql`extract(year from ${books.addedAt})`;
    const monthExpr = sql`extract(month from ${books.addedAt})`;

    return this.db
      .select({
        year: sql<number>`${yearExpr}::int`,
        month: sql<number>`${monthExpr}::int`,
        format: bookFiles.format,
        count: sql<number>`count(distinct ${bookFiles.bookId})::int`,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(isNotNull(bookFiles.format), filter))
      .groupBy(yearExpr, monthExpr, bookFiles.format)
      .orderBy(yearExpr, monthExpr, bookFiles.format);
  }

  async genreCountsByYear(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const yearExpr = sql`extract(year from ${books.addedAt})`;

    return this.db
      .select({
        year: sql<number>`${yearExpr}::int`,
        genre: genres.name,
        count: sql<number>`count(distinct ${bookGenres.bookId})::int`,
      })
      .from(bookGenres)
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .innerJoin(books, eq(books.id, bookGenres.bookId))
      .where(filter)
      .groupBy(yearExpr, genres.name)
      .orderBy(yearExpr, desc(sql<number>`count(distinct ${bookGenres.bookId})`), genres.name);
  }

  async pageCountDistributionByFormat(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]) {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const [items, [unknown]] = await Promise.all([
      this.db
        .select({
          format: bookFiles.format,
          count: sql<number>`count(*)::int`,
          min: sql<number>`min(${bookMetadata.pageCount})::int`,
          q1: sql<number>`percentile_cont(0.25) within group (order by ${bookMetadata.pageCount})::float`,
          median: sql<number>`percentile_cont(0.5) within group (order by ${bookMetadata.pageCount})::float`,
          q3: sql<number>`percentile_cont(0.75) within group (order by ${bookMetadata.pageCount})::float`,
          max: sql<number>`max(${bookMetadata.pageCount})::int`,
        })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
        .where(and(isNotNull(bookMetadata.pageCount), isNotNull(bookFiles.format), filter))
        .groupBy(bookFiles.format)
        .orderBy(desc(sql<number>`count(*)`)),
      this.db
        .select({
          unknownCount: sql<number>`count(*)::int`,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(isNull(bookMetadata.pageCount), filter)),
    ]);

    return { items, unknownCount: unknown?.unknownCount ?? 0 };
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

  async getGenreCooccurrence(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], limit = 15): Promise<ChordDiagramData> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const topGenresRows = await this.db
      .select({
        id: genres.id,
        name: genres.name,
      })
      .from(bookGenres)
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .innerJoin(books, eq(books.id, bookGenres.bookId))
      .where(filter)
      .groupBy(genres.id, genres.name)
      .orderBy(desc(sql`count(distinct ${bookGenres.bookId})`))
      .limit(limit);

    if (topGenresRows.length < 2) return { nodes: topGenresRows.map((g) => ({ name: g.name })), links: [] };

    const topGenreIds = topGenresRows.map((g) => g.id);
    const topGenreIdList = sql.join(
      topGenreIds.map((id) => sql`${id}`),
      sql`, `,
    );

    const pairRows = await this.db.execute<{ source: string; target: string; value: number }>(sql`
      select g1.name as source, g2.name as target, count(distinct bg1.book_id)::int as value
      from book_genres bg1
      inner join book_genres bg2 on bg1.book_id = bg2.book_id and bg1.genre_id < bg2.genre_id
      inner join genres g1 on g1.id = bg1.genre_id
      inner join genres g2 on g2.id = bg2.genre_id
      inner join books b on b.id = bg1.book_id
      where bg1.genre_id in (${topGenreIdList})
        and bg2.genre_id in (${topGenreIdList})
        ${filter ? sql`and ${filter}` : sql``}
      group by g1.name, g2.name
      having count(distinct bg1.book_id) >= 1
      order by value desc
    `);

    return {
      nodes: topGenresRows.map((g) => ({ name: g.name })),
      links: pairRows.rows.map((r) => ({ source: r.source, target: r.target, value: r.value })),
    };
  }
}
