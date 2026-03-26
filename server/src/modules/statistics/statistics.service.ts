import { Injectable } from '@nestjs/common';

import type {
  BooksAddedDataPoint,
  ChordDiagramData,
  FormatShareOverTimeItem,
  StatisticsSummary,
  GenreRankOverTimeItem,
  FormatDistributionItem,
  GenreDistributionItem,
  LibraryMetadataCompletenessItem,
  LanguageDistributionItem,
  MetadataScoreDistribution,
  MetadataCompletenessItem,
  PageCountDistributionItem,
  PublicationDecadeItem,
  StatisticsResult,
  StorageByFormatItem,
  TopAuthorItem,
} from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BooksOverTimeQueryDto } from './dto/books-over-time-query.dto';
import type { StatisticsFilterQueryDto } from './dto/statistics-filter-query.dto';
import { StatisticsRepository } from './statistics.repository';

const STATISTICS_TOP_N = 10;
const STREAM_TOP_FORMATS = 8;
const BUMP_TOP_GENRES = 8;

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

  async getGenreRankOverTime(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<GenreRankOverTimeItem>> {
    const raw = await this.repo.genreCountsByYear(user.id, user.isSuperuser, query.libraryIds);
    if (raw.length === 0) return { items: [], unknownCount: 0 };

    const genreTotals = new Map<string, number>();
    for (const row of raw) {
      genreTotals.set(row.genre, (genreTotals.get(row.genre) ?? 0) + row.count);
    }

    const trackedGenres = [...genreTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, BUMP_TOP_GENRES)
      .map(([genre]) => genre);

    const trackedSet = new Set(trackedGenres);
    const years = [...new Set(raw.map((r) => r.year))].sort((a, b) => a - b);
    const countsByYearGenre = new Map<string, number>();
    for (const row of raw) {
      if (!trackedSet.has(row.genre)) continue;
      countsByYearGenre.set(`${row.year}|${row.genre}`, row.count);
    }

    const items: GenreRankOverTimeItem[] = [];
    for (const year of years) {
      const entries = trackedGenres.map((genre) => ({
        genre,
        count: countsByYearGenre.get(`${year}|${genre}`) ?? 0,
      }));
      entries.sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
      entries.forEach((entry, i) => {
        items.push({ year, genre: entry.genre, rank: i + 1, count: entry.count });
      });
    }

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
}
