import { Injectable } from '@nestjs/common';

import type {
  AcquisitionLagPoint,
  BooksAddedDataPoint,
  ChordDiagramData,
  FormatShareOverTimeItem,
  LibraryIntegrityGauge,
  MetadataFreshnessGauge,
  StatisticsSummary,
  FormatDistributionItem,
  GenreDistributionItem,
  LibraryMetadataCompletenessItem,
  LanguageDistributionItem,
  LargestBookItem,
  MetadataScoreDistribution,
  MetadataCompletenessItem,
  PageCountDistributionItem,
  PublicationDecadeItem,
  PublicationYearPoint,
  StatisticsResult,
  StorageByFormatItem,
  TopAuthorItem,
  TopSeriesItem,
} from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BooksOverTimeQueryDto } from './dto/books-over-time-query.dto';
import type { StatisticsFilterQueryDto } from './dto/statistics-filter-query.dto';
import { StatisticsRepository } from './statistics.repository';

const STATISTICS_TOP_N = 10;
const STREAM_TOP_FORMATS = 8;

@Injectable()
export class StatisticsService {
  constructor(private readonly repo: StatisticsRepository) {}

  async getFormatDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<FormatDistributionItem>> {
    const raw = await this.repo.formatDistribution(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.map((r) => ({ format: r.format!, count: r.count }));
    return { items: this.clipToTopN(all, 'format'), unknownCount: 0 };
  }

  async getLanguageDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LanguageDistributionItem>> {
    const { items: raw, unknownCount } = await this.repo.languageDistribution(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.map((r) => ({ language: r.language!, count: r.count }));
    return { items: this.clipToTopN(all, 'language'), unknownCount };
  }

  async getBooksAddedOverTime(user: RequestUser, query: BooksOverTimeQueryDto): Promise<StatisticsResult<BooksAddedDataPoint>> {
    const items = await this.repo.booksAddedOverTime(user.id, user.isSuperuser, query.libraryIds, query.granularity, query.range);
    return { items, unknownCount: 0 };
  }

  async getMetadataScoreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<MetadataScoreDistribution> {
    const raw = await this.repo.metadataScoreDistribution(user.id, user.isSuperuser, query.libraryIds);
    const byMin = new Map(raw.bins.map((b) => [b.minScore, b.count]));
    const bins = Array.from({ length: 10 }, (_, i) => {
      const minScore = i * 10;
      const maxScore = i === 9 ? 100 : minScore + 9;
      return {
        minScore,
        maxScore,
        count: byMin.get(minScore) ?? 0,
      };
    });

    return {
      bins,
      unknownCount: raw.unknownCount,
      totalCount: raw.totalCount,
      percentile25: raw.percentile25,
      percentile50: raw.percentile50,
      percentile75: raw.percentile75,
      percentile90: raw.percentile90,
    };
  }

  async getLibraryMetadataCompleteness(
    user: RequestUser,
    query: StatisticsFilterQueryDto,
  ): Promise<StatisticsResult<LibraryMetadataCompletenessItem>> {
    const rows = await this.repo.libraryMetadataCompleteness(user.id, user.isSuperuser, query.libraryIds);
    const fieldDefs: Array<{ field: string; key: keyof (typeof rows)[number] }> = [
      { field: 'Title', key: 'hasTitle' },
      { field: 'Cover', key: 'hasCover' },
      { field: 'Author', key: 'hasAuthor' },
      { field: 'Genres', key: 'hasGenre' },
      { field: 'Tags', key: 'hasTag' },
      { field: 'Description', key: 'hasDescription' },
      { field: 'Publisher', key: 'hasPublisher' },
      { field: 'Year', key: 'hasYear' },
      { field: 'Language', key: 'hasLanguage' },
      { field: 'Page Count', key: 'hasPageCount' },
      { field: 'Rating', key: 'hasRating' },
      { field: 'Series', key: 'hasSeries' },
      { field: 'ISBN', key: 'hasIsbn' },
    ];

    const items: LibraryMetadataCompletenessItem[] = rows.flatMap((row) =>
      fieldDefs.map((f) => {
        const presentCount = Number(row[f.key] ?? 0);
        const totalCount = row.total ?? 0;
        return {
          libraryId: row.libraryId,
          libraryName: row.libraryName,
          field: f.field,
          presentCount,
          totalCount,
          percent: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
        };
      }),
    );

    return { items, unknownCount: 0 };
  }

  async getFormatShareOverTime(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<FormatShareOverTimeItem>> {
    const raw = await this.repo.formatShareOverTime(user.id, user.isSuperuser, query.libraryIds);
    const totals = new Map<string, number>();
    for (const row of raw) {
      const format = (row.format ?? 'unknown').toUpperCase();
      totals.set(format, (totals.get(format) ?? 0) + row.count);
    }

    const topFormats = new Set(
      [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, STREAM_TOP_FORMATS)
        .map(([f]) => f),
    );

    const grouped = new Map<string, FormatShareOverTimeItem>();
    for (const row of raw) {
      const normalizedFormat = (row.format ?? 'unknown').toUpperCase();
      const format = topFormats.has(normalizedFormat) ? normalizedFormat : 'OTHER';
      const key = `${row.year}-${row.month}-${format}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += row.count;
        continue;
      }
      grouped.set(key, { year: row.year, month: row.month, format, count: row.count });
    }

    const items = [...grouped.values()].sort((a, b) => a.year - b.year || a.month - b.month || a.format.localeCompare(b.format));
    return { items, unknownCount: 0 };
  }

  async getPageCountDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PageCountDistributionItem>> {
    const { items: raw, unknownCount } = await this.repo.pageCountDistributionByFormat(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.map((row) => ({
      format: row.format!.toUpperCase(),
      count: row.count,
      min: row.min,
      q1: Number(row.q1),
      median: Number(row.median),
      q3: Number(row.q3),
      max: row.max,
    }));
    return { items, unknownCount };
  }

  async getStorageByFormat(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<StorageByFormatItem>> {
    const raw = await this.repo.storageByFormat(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.map((r) => ({ format: r.format!, sizeBytes: Number(r.sizeBytes) }));
    return { items: this.clipStorageToTopN(all), unknownCount: 0 };
  }

  async getPublicationDecade(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PublicationDecadeItem>> {
    const { items, unknownCount } = await this.repo.publicationDecade(user.id, user.isSuperuser, query.libraryIds);
    return { items, unknownCount };
  }

  async getPublicationYearTimeline(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PublicationYearPoint>> {
    const { items, unknownCount } = await this.repo.publicationYearTimeline(user.id, user.isSuperuser, query.libraryIds);
    return { items, unknownCount };
  }

  async getTopAuthors(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<TopAuthorItem>> {
    const raw = await this.repo.topAuthors(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.slice(0, 25).map((r) => ({ name: r.name, count: r.count }));
    return { items, unknownCount: 0 };
  }

  async getMetadataCompleteness(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<MetadataCompletenessItem>> {
    const row = await this.repo.metadataCompleteness(user.id, user.isSuperuser, query.libraryIds);
    const total = row.total ?? 0;
    const fields: Array<{ field: string; presentCount: number }> = [
      { field: 'Cover', presentCount: row.hasCover ?? 0 },
      { field: 'Author', presentCount: row.hasAuthor ?? 0 },
      { field: 'Description', presentCount: row.hasDescription ?? 0 },
      { field: 'Publisher', presentCount: row.hasPublisher ?? 0 },
      { field: 'Year', presentCount: row.hasYear ?? 0 },
      { field: 'Language', presentCount: row.hasLanguage ?? 0 },
      { field: 'Page Count', presentCount: row.hasPageCount ?? 0 },
      { field: 'Rating', presentCount: row.hasRating ?? 0 },
      { field: 'Series', presentCount: row.hasSeries ?? 0 },
      { field: 'ISBN', presentCount: row.hasIsbn ?? 0 },
    ];
    const items = fields
      .map((f) => ({ field: f.field, presentCount: f.presentCount, totalCount: total }))
      .sort((a, b) => b.presentCount - a.presentCount);
    return { items, unknownCount: 0 };
  }

  async getGenreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<GenreDistributionItem>> {
    const { items: raw, unknownCount } = await this.repo.genreDistribution(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.slice(0, 25).map((r) => ({ genre: r.genre, count: r.count }));
    return { items, unknownCount };
  }

  async getMetadataFreshnessGauge(user: RequestUser, query: StatisticsFilterQueryDto): Promise<MetadataFreshnessGauge> {
    const row = await this.repo.metadataFreshnessGauge(user.id, user.isSuperuser, query.libraryIds);
    const totalBooks = row.totalBooks ?? 0;
    const fresh30dCount = row.fresh30dCount ?? 0;
    const stale31To90dCount = row.stale31To90dCount ?? 0;
    const stale91To180dCount = row.stale91To180dCount ?? 0;
    const staleOver180dCount = row.staleOver180dCount ?? 0;
    const neverFetchedCount = row.neverFetchedCount ?? 0;

    const weightedFreshness = fresh30dCount + stale31To90dCount * 0.7 + stale91To180dCount * 0.4 + staleOver180dCount * 0.15;
    const freshnessScore = totalBooks > 0 ? Math.round((weightedFreshness / totalBooks) * 100) : 0;

    return {
      totalBooks,
      neverFetchedCount,
      fresh30dCount,
      stale31To90dCount,
      stale91To180dCount,
      staleOver180dCount,
      freshnessScore,
    };
  }

  async getLibraryIntegrityGauge(user: RequestUser, query: StatisticsFilterQueryDto): Promise<LibraryIntegrityGauge> {
    const row = await this.repo.libraryIntegrityGauge(user.id, user.isSuperuser, query.libraryIds);
    const totalBooks = row.totalBooks ?? 0;
    const presentCount = row.presentCount ?? 0;
    const primaryFileCount = row.primaryFileCount ?? 0;
    const metadataCount = row.metadataCount ?? 0;

    const presentRatio = totalBooks > 0 ? presentCount / totalBooks : 0;
    const primaryFileRatio = totalBooks > 0 ? primaryFileCount / totalBooks : 0;
    const metadataRatio = totalBooks > 0 ? metadataCount / totalBooks : 0;
    const integrityScore = Math.round(((presentRatio + primaryFileRatio + metadataRatio) / 3) * 100);

    return {
      totalBooks,
      presentCount,
      primaryFileCount,
      metadataCount,
      integrityScore,
    };
  }

  async getAcquisitionLagScatter(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<AcquisitionLagPoint>> {
    const { items, unknownCount } = await this.repo.acquisitionLagScatter(user.id, user.isSuperuser, query.libraryIds);
    return { items, unknownCount };
  }

  private clipToTopN<T extends { count: number }>(items: T[], labelKey: keyof T, n = STATISTICS_TOP_N): T[] {
    if (items.length <= n) return items;
    const top = items.slice(0, n);
    const otherCount = items.slice(n).reduce((s, item) => s + item.count, 0);
    return [...top, { [labelKey]: 'Other', count: otherCount } as unknown as T];
  }

  private clipStorageToTopN(items: StorageByFormatItem[]): StorageByFormatItem[] {
    if (items.length <= STATISTICS_TOP_N) return items;
    const top = items.slice(0, STATISTICS_TOP_N);
    const otherBytes = items.slice(STATISTICS_TOP_N).reduce((s, item) => s + item.sizeBytes, 0);
    return [...top, { format: 'Other', sizeBytes: otherBytes }];
  }

  async getSummary(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsSummary> {
    return this.repo.getSummary(user.id, user.isSuperuser, query.libraryIds);
  }

  async getGenreCooccurrence(user: RequestUser, query: StatisticsFilterQueryDto): Promise<ChordDiagramData> {
    return this.repo.getGenreCooccurrence(user.id, user.isSuperuser, query.libraryIds);
  }

  async getLargestBooks(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LargestBookItem>> {
    const raw = await this.repo.largestBooks(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.map((r) => ({ id: r.id, title: r.title!, sizeBytes: Number(r.sizeBytes), format: r.format! }));
    return { items, unknownCount: 0 };
  }

  async getTopSeries(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<TopSeriesItem>> {
    const raw = await this.repo.topSeries(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.map((r) => ({ name: r.name!, count: r.count }));
    return { items, unknownCount: 0 };
  }
}
