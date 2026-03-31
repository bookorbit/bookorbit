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
const TOP_LIST_LIMIT = 25;
const METADATA_SCORE_BIN_COUNT = 10;
const OTHER_BUCKET_LABEL = 'Other';
const UNKNOWN_FORMAT_LABEL = 'UNKNOWN';

type MetadataCompletenessFieldKey =
  | 'hasTitle'
  | 'hasCover'
  | 'hasAuthor'
  | 'hasGenre'
  | 'hasTag'
  | 'hasDescription'
  | 'hasPublisher'
  | 'hasYear'
  | 'hasLanguage'
  | 'hasPageCount'
  | 'hasRating'
  | 'hasSeries'
  | 'hasIsbn';

type MetadataCompletenessFieldDefinition = {
  field: string;
  key: MetadataCompletenessFieldKey;
  includeInOverall: boolean;
};

const METADATA_COMPLETENESS_FIELDS: MetadataCompletenessFieldDefinition[] = [
  { field: 'Title', key: 'hasTitle', includeInOverall: false },
  { field: 'Cover', key: 'hasCover', includeInOverall: true },
  { field: 'Author', key: 'hasAuthor', includeInOverall: true },
  { field: 'Genres', key: 'hasGenre', includeInOverall: false },
  { field: 'Tags', key: 'hasTag', includeInOverall: false },
  { field: 'Description', key: 'hasDescription', includeInOverall: true },
  { field: 'Publisher', key: 'hasPublisher', includeInOverall: true },
  { field: 'Year', key: 'hasYear', includeInOverall: true },
  { field: 'Language', key: 'hasLanguage', includeInOverall: true },
  { field: 'Page Count', key: 'hasPageCount', includeInOverall: true },
  { field: 'Rating', key: 'hasRating', includeInOverall: true },
  { field: 'Series', key: 'hasSeries', includeInOverall: true },
  { field: 'ISBN', key: 'hasIsbn', includeInOverall: true },
];

@Injectable()
export class StatisticsService {
  constructor(private readonly repo: StatisticsRepository) {}

  async getFormatDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<FormatDistributionItem>> {
    const raw = await this.repo.formatDistribution(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.flatMap((r) => (r.format ? [{ format: r.format, count: r.count }] : []));
    return { items: this.clipCountsToTopN(all, (count) => ({ format: OTHER_BUCKET_LABEL, count })), unknownCount: 0 };
  }

  async getLanguageDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LanguageDistributionItem>> {
    const { items: raw, unknownCount } = await this.repo.languageDistribution(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.flatMap((r) => (r.language ? [{ language: r.language, count: r.count }] : []));
    return { items: this.clipCountsToTopN(all, (count) => ({ language: OTHER_BUCKET_LABEL, count })), unknownCount };
  }

  async getBooksAddedOverTime(user: RequestUser, query: BooksOverTimeQueryDto): Promise<StatisticsResult<BooksAddedDataPoint>> {
    const items = await this.repo.booksAddedOverTime(user.id, user.isSuperuser, query.libraryIds, query.granularity, query.range);
    return { items, unknownCount: 0 };
  }

  async getMetadataScoreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<MetadataScoreDistribution> {
    const raw = await this.repo.metadataScoreDistribution(user.id, user.isSuperuser, query.libraryIds);
    const byMin = new Map(raw.bins.map((b) => [b.minScore, b.count]));
    const bins = Array.from({ length: METADATA_SCORE_BIN_COUNT }, (_, i) => {
      const minScore = i * 10;
      const maxScore = i === METADATA_SCORE_BIN_COUNT - 1 ? 100 : minScore + 9;
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

    const items: LibraryMetadataCompletenessItem[] = rows.flatMap((row) =>
      METADATA_COMPLETENESS_FIELDS.map((f) => {
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
      const format = this.normalizeFormatLabel(row.format);
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
      const normalizedFormat = this.normalizeFormatLabel(row.format);
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
    const items = raw.flatMap((row) =>
      row.format
        ? [
            {
              format: row.format.toUpperCase(),
              count: row.count,
              min: row.min,
              q1: Number(row.q1),
              median: Number(row.median),
              q3: Number(row.q3),
              max: row.max,
            },
          ]
        : [],
    );
    return { items, unknownCount };
  }

  async getStorageByFormat(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<StorageByFormatItem>> {
    const raw = await this.repo.storageByFormat(user.id, user.isSuperuser, query.libraryIds);
    const all = raw.flatMap((r) => (r.format ? [{ format: r.format, sizeBytes: Number(r.sizeBytes) }] : []));
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
    const items = raw.slice(0, TOP_LIST_LIMIT).map((r) => ({ name: r.name, count: r.count }));
    return { items, unknownCount: 0 };
  }

  async getMetadataCompleteness(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<MetadataCompletenessItem>> {
    const row = await this.repo.metadataCompleteness(user.id, user.isSuperuser, query.libraryIds);
    const total = row?.total ?? 0;
    const items = METADATA_COMPLETENESS_FIELDS.filter((fieldDef) => fieldDef.includeInOverall)
      .map((fieldDef) => ({ field: fieldDef.field, presentCount: row?.[fieldDef.key] ?? 0, totalCount: total }))
      .sort((a, b) => b.presentCount - a.presentCount);
    return { items, unknownCount: 0 };
  }

  async getGenreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<GenreDistributionItem>> {
    const { items: raw, unknownCount } = await this.repo.genreDistribution(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.slice(0, TOP_LIST_LIMIT).map((r) => ({ genre: r.genre, count: r.count }));
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

  private clipCountsToTopN<T extends { count: number }>(items: T[], createOtherItem: (count: number) => T, n = STATISTICS_TOP_N): T[] {
    if (items.length <= n) return items;
    const top = items.slice(0, n);
    const otherCount = items.slice(n).reduce((sum, item) => sum + item.count, 0);
    return [...top, createOtherItem(otherCount)];
  }

  private normalizeFormatLabel(format: string | null | undefined): string {
    return (format ?? UNKNOWN_FORMAT_LABEL).toUpperCase();
  }

  private clipStorageToTopN(items: StorageByFormatItem[]): StorageByFormatItem[] {
    if (items.length <= STATISTICS_TOP_N) return items;
    const top = items.slice(0, STATISTICS_TOP_N);
    const otherBytes = items.slice(STATISTICS_TOP_N).reduce((sum, item) => sum + item.sizeBytes, 0);
    return [...top, { format: OTHER_BUCKET_LABEL, sizeBytes: otherBytes }];
  }

  async getSummary(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsSummary> {
    return this.repo.getSummary(user.id, user.isSuperuser, query.libraryIds);
  }

  async getGenreCooccurrence(user: RequestUser, query: StatisticsFilterQueryDto): Promise<ChordDiagramData> {
    return this.repo.getGenreCooccurrence(user.id, user.isSuperuser, query.libraryIds);
  }

  async getLargestBooks(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LargestBookItem>> {
    const raw = await this.repo.largestBooks(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.flatMap((r) => (r.title && r.format ? [{ id: r.id, title: r.title, sizeBytes: Number(r.sizeBytes), format: r.format }] : []));
    return { items, unknownCount: 0 };
  }

  async getTopSeries(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<TopSeriesItem>> {
    const raw = await this.repo.topSeries(user.id, user.isSuperuser, query.libraryIds);
    const items = raw.flatMap((r) => (r.name ? [{ name: r.name, count: r.count }] : []));
    return { items, unknownCount: 0 };
  }
}
