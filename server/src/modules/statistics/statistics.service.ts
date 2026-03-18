import { Injectable } from '@nestjs/common';

import type {
  BooksAddedDataPoint,
  StatisticsSummary,
  FormatDistributionItem,
  GenreDistributionItem,
  LanguageDistributionItem,
  MetadataCompletenessItem,
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
}
