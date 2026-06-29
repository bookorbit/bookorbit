import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename, extname } from 'path';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { FastifyReply } from 'fastify';

import type {
  KoreaderCatalogBookDetail,
  KoreaderCatalogBookListItem,
  KoreaderCatalogDashboardResponse,
  KoreaderCatalogDiscoverResponse,
  KoreaderCatalogEntry,
  KoreaderCatalogFile,
  KoreaderCatalogPage,
  KoreaderCatalogProgress,
  KoreaderCatalogRatingResult,
  KoreaderCatalogReadStatusResult,
  KoreaderCatalogSection,
  KoreaderCatalogSectionResponse,
  KoreaderCatalogSeriesSummary,
  KoreaderCatalogSettableReadStatus,
  KoreaderCatalogSort,
  KoreaderCatalogSortOrder,
} from '@bookorbit/types';
import { bookThumbnailPath } from '../../common/book-cover-storage';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { storageConfig } from '../../config/config';
import { BookReadService } from '../book/book-read.service';
import { BookService } from '../book/book.service';
import type { BookDetailDto } from '../book/dto/book-detail.dto';
import { DashboardWidgetService } from '../dashboard/dashboard-widget.service';
import { fileMimeType } from '../opds/opds-xml.helpers';
import { OpdsBookEntry, OpdsBookService } from '../opds/opds-book.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { KoreaderCatalogBooksQueryDto } from './dto/koreader-catalog-query.dto';

type OpdsSortOrder = Parameters<OpdsBookService['getBooksPage']>[1];
type BookProgressRow = Awaited<ReturnType<BookReadService['findProgressByBook']>>[number];
type ProgressCandidate = BookProgressRow & { percentage: number; updatedAt: Date };
type BatchProgressRow = Awaited<ReturnType<BookReadService['findProgressByBooks']>>[number];
type BatchProgressCandidate = BatchProgressRow & { percentage: number; updatedAt: Date };

const CATALOG_BASE = '/api/v1/koreader/plugin/catalog';
const AUTHOR_SERIES_PAGE_SIZE = 60;
const DASHBOARD_CONTINUE_READING_LIMIT = 5;
const DASHBOARD_DISCOVER_LIMIT = 8;

const NATURAL_SORT_ORDER: Record<KoreaderCatalogSort, KoreaderCatalogSortOrder> = {
  title: 'asc',
  author: 'asc',
  series: 'asc',
  recently_added: 'desc',
  recently_updated: 'desc',
  recently_read: 'desc',
};

const ROOT_SECTIONS: KoreaderCatalogEntry[] = [
  {
    id: 'continue-reading',
    title: 'Continue reading',
    section: 'continue-reading',
    booksHref: `${CATALOG_BASE}/books?sort=recently_read&readStatus=reading`,
  },
  {
    id: 'recent',
    title: 'Recently added',
    section: 'recent',
    booksHref: `${CATALOG_BASE}/books?sort=recently_added`,
  },
  {
    id: 'libraries',
    title: 'Libraries',
    section: 'libraries',
    href: `${CATALOG_BASE}/sections/libraries`,
  },
  {
    id: 'collections',
    title: 'Collections',
    section: 'collections',
    href: `${CATALOG_BASE}/sections/collections`,
  },
  {
    id: 'smart-scopes',
    title: 'SmartScopes',
    section: 'smart-scopes',
    href: `${CATALOG_BASE}/sections/smart-scopes`,
  },
  {
    id: 'authors',
    title: 'Authors',
    section: 'authors',
    href: `${CATALOG_BASE}/sections/authors`,
  },
  {
    id: 'series',
    title: 'Series',
    section: 'series',
    href: `${CATALOG_BASE}/sections/series`,
  },
  {
    id: 'all-books',
    title: 'All Books',
    section: 'all-books',
    booksHref: `${CATALOG_BASE}/books?sort=title`,
  },
];

@Injectable()
export class KoreaderCatalogService {
  constructor(
    private readonly opdsBookService: OpdsBookService,
    private readonly bookService: BookService,
    private readonly bookReadService: BookReadService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly dashboardWidgetService: DashboardWidgetService,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  getRoot(): { sections: KoreaderCatalogEntry[] } {
    return { sections: ROOT_SECTIONS.map((section) => ({ ...section })) };
  }

  async getDashboard(user: RequestUser): Promise<KoreaderCatalogDashboardResponse> {
    const continueReadingQuery = Object.assign(new KoreaderCatalogBooksQueryDto(), {
      page: 1,
      size: DASHBOARD_CONTINUE_READING_LIMIT,
      sort: 'recently_read' as const,
      readStatus: 'reading' as const,
    });

    const [continueReading, discover, readingGoal, readingStreak, highlightOfTheDay] = await Promise.all([
      this.getBooksPage(user, continueReadingQuery),
      this.buildDiscover(user),
      this.dashboardWidgetService.getReadingGoal(user),
      this.dashboardWidgetService.getReadingStreak(user),
      this.dashboardWidgetService.getHighlightOfTheDay(user),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      sections: ROOT_SECTIONS.map((section) => ({ ...section })),
      continueReading: continueReading.items,
      discover,
      readingGoal,
      readingStreak,
      highlightOfTheDay,
    };
  }

  async getDiscover(user: RequestUser): Promise<KoreaderCatalogDiscoverResponse> {
    return { discover: await this.buildDiscover(user) };
  }

  private async buildDiscover(user: RequestUser): Promise<KoreaderCatalogBookListItem[]> {
    const entries = await this.opdsBookService.getRandomBooks(user.id, DASHBOARD_DISCOVER_LIMIT, user.isSuperuser, user.contentFilters);
    if (entries.length === 0) return [];

    const bookIds = entries.map((entry) => entry.id);
    const [progressMap, statusMap] = await Promise.all([
      this.findBestProgressMap(user.id, bookIds),
      this.userBookStatusService.findByBookIds(user.id, bookIds),
    ]);
    return entries.map((entry) => this.mapBookListItem(entry, progressMap.get(entry.id) ?? null, statusMap.get(entry.id)?.status ?? null));
  }

  async getSectionEntries(user: RequestUser, section: string, query: { page?: number; q?: string } = {}): Promise<KoreaderCatalogSectionResponse> {
    switch (section) {
      case 'libraries':
        return { section, items: await this.getLibraryEntries(user) };
      case 'collections':
        return { section, items: await this.getCollectionEntries(user) };
      case 'smart-scopes':
        return { section, items: await this.getSmartScopeEntries(user) };
      case 'authors':
        return this.getAuthorsSection(user, query);
      case 'series':
        return this.getSeriesSection(user, query);
      default:
        throw new BadRequestException('Unknown catalog section');
    }
  }

  async getBooksPage(user: RequestUser, query: KoreaderCatalogBooksQueryDto): Promise<KoreaderCatalogPage<KoreaderCatalogBookListItem>> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    this.assertPaginationWindow(page, size);

    const filters = this.buildBookFilters(query);
    const sort = this.mapSort(query.sort ?? 'recently_added', query.order);
    const { entries, total } = await this.opdsBookService.getBooksPage(user.id, sort, page, size, filters, user.isSuperuser, user.contentFilters);

    const bookIds = entries.map((entry) => entry.id);
    const [progressMap, statusMap, seriesSummary] = await Promise.all([
      this.findBestProgressMap(user.id, bookIds),
      this.userBookStatusService.findByBookIds(user.id, bookIds),
      filters.seriesId !== undefined || filters.series ? this.computeSeriesSummary(user, filters) : Promise.resolve(null),
    ]);

    const items = entries.map((entry) => this.mapBookListItem(entry, progressMap.get(entry.id) ?? null, statusMap.get(entry.id)?.status ?? null));
    return this.paginate(items, total, page, size, query, seriesSummary);
  }

  async setReadStatus(user: RequestUser, bookId: number, status: KoreaderCatalogSettableReadStatus): Promise<KoreaderCatalogReadStatusResult> {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.userBookStatusService.setManual(user.id, bookId, status);
    return { readStatus: status };
  }

  async setRating(user: RequestUser, bookId: number, rating: number | null): Promise<KoreaderCatalogRatingResult> {
    const normalized = rating ?? null;
    await this.bookService.bulkSetRating([bookId], normalized, user);
    return { rating: normalized };
  }

  async getBookDetail(user: RequestUser, bookId: number): Promise<KoreaderCatalogBookDetail> {
    const detail = await this.bookService.getDetail(bookId, user);
    const progress = await this.findBestProgress(user.id, detail.id);
    return this.mapBookDetail(detail, progress);
  }

  async streamThumbnail(user: RequestUser, bookId: number, reply: FastifyReply, ifNoneMatch?: string): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const thumbnailPath = bookThumbnailPath(this.storage.appDataPath, bookId);
    try {
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(thumbnailPath));
      reply.send(createReadStream(thumbnailPath));
    } catch {
      throw new NotFoundException('No thumbnail');
    }
  }

  async streamFile(user: RequestUser, fileId: number, reply: FastifyReply): Promise<void> {
    const file = await this.bookService.verifyFileAccess(fileId, user);
    if (file.role !== 'content') {
      throw new NotFoundException('File not found');
    }

    const detail = await this.bookService.getDetail(file.bookId, user);
    const format = this.normalizeFormat(file.format);
    const filename = this.downloadFilename(detail, fileId, format);

    try {
      const { size } = await stat(file.absolutePath);
      reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
      reply.header('Content-Length', size);
      reply.type(fileMimeType(format));
      reply.send(createReadStream(file.absolutePath));
    } catch {
      throw new NotFoundException('File not found on disk');
    }
  }

  private async getLibraryEntries(user: RequestUser): Promise<KoreaderCatalogEntry[]> {
    const rows = await this.opdsBookService.getAccessibleLibraries(user.id, user.isSuperuser);
    return Promise.all(
      rows.map(async (row) => {
        const count = await this.countBooks(user, { libraryId: row.id });
        return {
          id: String(row.id),
          title: row.name,
          section: 'libraries',
          count,
          booksHref: this.booksHref({ libraryId: row.id, sort: 'title' }),
        };
      }),
    );
  }

  private async getCollectionEntries(user: RequestUser): Promise<KoreaderCatalogEntry[]> {
    const rows = await this.opdsBookService.getUserCollections(user.id);
    return Promise.all(
      rows.map(async (row) => {
        const count = await this.countBooks(user, { collectionId: row.id });
        return {
          id: String(row.id),
          title: row.name,
          section: 'collections',
          count,
          booksHref: this.booksHref({ collectionId: row.id, sort: 'title' }),
        };
      }),
    );
  }

  private async getSmartScopeEntries(user: RequestUser): Promise<KoreaderCatalogEntry[]> {
    const rows = await this.opdsBookService.getUserSmartScopes(user.id);
    return rows.map((row) => ({
      id: String(row.id),
      title: row.name,
      section: 'smart-scopes',
      icon: row.icon ?? null,
      booksHref: this.booksHref({ smartScopeId: row.id, sort: 'title' }),
    }));
  }

  private async getAuthorsSection(user: RequestUser, query: { page?: number; q?: string }): Promise<KoreaderCatalogSectionResponse> {
    const page = query.page ?? 1;
    const offset = (page - 1) * AUTHOR_SERIES_PAGE_SIZE;
    const { items, hasNext } = await this.opdsBookService.getDistinctAuthorsPage(
      user.id,
      { q: query.q, limit: AUTHOR_SERIES_PAGE_SIZE, offset },
      user.isSuperuser,
      user.contentFilters,
    );
    const entries: KoreaderCatalogEntry[] = items.map((row) => ({
      id: row.name,
      title: row.name,
      section: 'authors',
      count: row.bookCount,
      booksHref: this.booksHref({ author: row.name, sort: 'title' }),
    }));
    return this.buildSectionPage('authors', entries, page, hasNext, query.q);
  }

  private async getSeriesSection(user: RequestUser, query: { page?: number; q?: string }): Promise<KoreaderCatalogSectionResponse> {
    const page = query.page ?? 1;
    const offset = (page - 1) * AUTHOR_SERIES_PAGE_SIZE;
    const { items, hasNext } = await this.opdsBookService.getDistinctSeriesPage(
      user.id,
      { q: query.q, limit: AUTHOR_SERIES_PAGE_SIZE, offset },
      user.isSuperuser,
      user.contentFilters,
    );
    const entries: KoreaderCatalogEntry[] = items.map((row) => ({
      id: this.seriesEntryId(row.id),
      title: row.name,
      section: 'series',
      count: row.bookCount,
      seriesId: row.id,
      booksHref: this.booksHref({ seriesId: row.id, sort: 'series' }),
    }));
    return this.buildSectionPage('series', entries, page, hasNext, query.q);
  }

  private seriesEntryId(seriesId: number): string {
    return `series:${seriesId}`;
  }

  private buildSectionPage(
    section: KoreaderCatalogSection,
    items: KoreaderCatalogEntry[],
    page: number,
    hasNext: boolean,
    q?: string,
  ): KoreaderCatalogSectionResponse {
    const hasPrevious = page > 1;
    return {
      section,
      items,
      page,
      hasNext,
      hasPrevious,
      nextUrl: hasNext ? this.sectionHref(section, page + 1, q) : null,
      previousUrl: hasPrevious ? this.sectionHref(section, page - 1, q) : null,
      query: q?.trim() ? q.trim() : null,
    };
  }

  private sectionHref(section: KoreaderCatalogSection, page: number, q?: string): string {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (q?.trim()) search.set('q', q.trim());
    const suffix = search.toString();
    return suffix ? `${CATALOG_BASE}/sections/${section}?${suffix}` : `${CATALOG_BASE}/sections/${section}`;
  }

  private async countBooks(
    user: RequestUser,
    filters: {
      libraryId?: number;
      collectionId?: number;
      series?: string;
      seriesId?: number;
      readStatus?: 'unread' | 'reading' | 'finished';
    },
  ): Promise<number> {
    const result = await this.opdsBookService.getBooksPage(user.id, 'title_asc', 1, 1, filters, user.isSuperuser, user.contentFilters);
    return result.total;
  }

  private async computeSeriesSummary(user: RequestUser, filters: { series?: string; seriesId?: number }): Promise<KoreaderCatalogSeriesSummary> {
    const [total, finished] = await Promise.all([this.countBooks(user, filters), this.countBooks(user, { ...filters, readStatus: 'finished' })]);
    return { total, finished };
  }

  private mapBookListItem(entry: OpdsBookEntry, progress: KoreaderCatalogProgress | null, readStatus: string | null): KoreaderCatalogBookListItem {
    const formats = this.uniqueFormats(entry.files.map((file) => file.format));
    return {
      id: entry.id,
      title: entry.title,
      authors: entry.authors,
      seriesId: entry.seriesId ?? null,
      seriesName: entry.seriesName,
      seriesIndex: entry.seriesIndex,
      progressPercentage: progress?.percentage ?? null,
      readStatus,
      formats,
      hasCover: entry.hasCover,
      thumbnailUrl: entry.hasCover ? `${CATALOG_BASE}/books/${entry.id}/thumbnail` : null,
      detailUrl: `${CATALOG_BASE}/books/${entry.id}`,
      addedAt: entry.addedAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private mapBookDetail(detail: BookDetailDto, progress: KoreaderCatalogProgress | null): KoreaderCatalogBookDetail {
    const title = detail.title ?? (basename(detail.folderPath) || `Book ${detail.id}`);
    const files = detail.files
      .filter((file) => file.role === 'primary' || file.role === 'content')
      .map<KoreaderCatalogFile>((file) => ({
        id: file.id,
        format: this.normalizeFormat(file.format),
        role: file.role,
        sizeBytes: file.sizeBytes,
        durationSeconds: file.durationSeconds,
        downloadUrl: `${CATALOG_BASE}/files/${file.id}/download`,
      }));

    return {
      id: detail.id,
      title,
      authors: detail.authors.map((author) => author.name),
      seriesId: detail.seriesId,
      seriesName: detail.seriesName,
      seriesIndex: detail.seriesIndex,
      progressPercentage: progress?.percentage ?? null,
      readStatus: detail.readStatus?.status ?? null,
      formats: this.uniqueFormats(files.map((file) => file.format)),
      hasCover: detail.coverSource !== null,
      thumbnailUrl: detail.coverSource !== null ? `${CATALOG_BASE}/books/${detail.id}/thumbnail` : null,
      detailUrl: `${CATALOG_BASE}/books/${detail.id}`,
      addedAt: detail.addedAt.toISOString(),
      updatedAt: (detail.updatedAt ?? detail.addedAt).toISOString(),
      subtitle: detail.subtitle,
      description: detail.description,
      publisher: detail.publisher,
      publishedYear: detail.publishedYear,
      language: detail.language,
      isbn10: detail.isbn10,
      isbn13: detail.isbn13,
      libraryId: detail.libraryId,
      libraryName: detail.libraryName,
      rating: detail.rating,
      pageCount: detail.pageCount,
      collections: detail.collections,
      genres: detail.genres,
      tags: detail.tags,
      progress,
      files,
    };
  }

  private async findBestProgress(userId: number, bookId: number): Promise<KoreaderCatalogProgress | null> {
    const rows = await this.bookReadService.findProgressByBook(userId, bookId);
    let best: ProgressCandidate | null = null;
    for (const row of rows) {
      if (row.percentage == null || row.updatedAt == null) continue;
      const candidate = row as ProgressCandidate;
      if (!best || candidate.updatedAt > best.updatedAt) {
        best = candidate;
      }
    }

    return best ? this.mapProgress(best) : null;
  }

  private async findBestProgressMap(userId: number, bookIds: number[]): Promise<Map<number, KoreaderCatalogProgress>> {
    const map = new Map<number, KoreaderCatalogProgress>();
    if (bookIds.length === 0) return map;

    const rows = await this.bookReadService.findProgressByBooks(userId, bookIds);
    const best = new Map<number, BatchProgressCandidate>();
    for (const row of rows) {
      if (row.percentage == null || row.updatedAt == null) continue;
      const candidate = row as BatchProgressCandidate;
      const current = best.get(row.bookId);
      if (!current || candidate.updatedAt > current.updatedAt) {
        best.set(row.bookId, candidate);
      }
    }

    for (const [bookId, candidate] of best) {
      map.set(bookId, {
        fileId: candidate.fileId,
        percentage: candidate.percentage,
        koreaderProgress: candidate.koreaderProgress ?? null,
        updatedAt: candidate.updatedAt.toISOString(),
      });
    }
    return map;
  }

  private mapProgress(row: ProgressCandidate): KoreaderCatalogProgress {
    return {
      fileId: row.fileId,
      percentage: row.percentage ?? 0,
      koreaderProgress: row.koreaderProgress ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildBookFilters(query: KoreaderCatalogBooksQueryDto): {
    libraryId?: number;
    collectionId?: number;
    smartScopeId?: number;
    author?: string;
    series?: string;
    seriesId?: number;
    q?: string;
    readStatus?: 'unread' | 'reading' | 'finished';
    format?: string;
    ids?: number[];
  } {
    return {
      ...(query.libraryId !== undefined ? { libraryId: query.libraryId } : {}),
      ...(query.collectionId !== undefined ? { collectionId: query.collectionId } : {}),
      ...(query.smartScopeId !== undefined ? { smartScopeId: query.smartScopeId } : {}),
      ...(query.author ? { author: query.author } : {}),
      ...(query.seriesId !== undefined ? { seriesId: query.seriesId } : {}),
      ...(query.series ? { series: query.series } : {}),
      ...(query.q?.trim() ? { q: query.q.trim() } : {}),
      ...(query.readStatus ? { readStatus: query.readStatus } : {}),
      ...(query.format?.trim() ? { format: query.format.trim().toLowerCase() } : {}),
      ...(query.ids ? { ids: query.ids } : {}),
    };
  }

  private mapSort(sort: KoreaderCatalogSort, order?: KoreaderCatalogSortOrder): OpdsSortOrder {
    const direction = order ?? NATURAL_SORT_ORDER[sort];
    const descending = direction === 'desc';
    switch (sort) {
      case 'title':
        return descending ? 'title_desc' : 'title_asc';
      case 'author':
        return descending ? 'author_desc' : 'author_asc';
      case 'recently_updated':
        return descending ? 'updated' : 'updated_asc';
      case 'recently_read':
        return descending ? 'recently_read' : 'recently_read_asc';
      case 'series':
        return descending ? 'series_desc' : 'series_asc';
      case 'recently_added':
      default:
        return descending ? 'recent' : 'recent_asc';
    }
  }

  private paginate<T>(
    items: T[],
    total: number,
    page: number,
    size: number,
    query: KoreaderCatalogBooksQueryDto,
    seriesSummary: KoreaderCatalogSeriesSummary | null = null,
  ): KoreaderCatalogPage<T> {
    const hasNext = page * size < total;
    const hasPrevious = page > 1;
    return {
      items,
      total,
      page,
      size,
      hasNext,
      hasPrevious,
      nextUrl: hasNext ? this.pageHref(query, page + 1, size) : null,
      previousUrl: hasPrevious ? this.pageHref(query, page - 1, size) : null,
      seriesSummary,
    };
  }

  private pageHref(query: KoreaderCatalogBooksQueryDto, page: number, size: number): string {
    return this.booksHref({ ...query, page, size });
  }

  private booksHref(params: Partial<KoreaderCatalogBooksQueryDto>): string {
    const search = new URLSearchParams();
    const orderedKeys = [
      'page',
      'size',
      'sort',
      'order',
      'q',
      'readStatus',
      'format',
      'ids',
      'libraryId',
      'collectionId',
      'smartScopeId',
      'author',
      'seriesId',
      'series',
    ] as const;
    for (const key of orderedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
    }
    const suffix = search.toString();
    return suffix ? `${CATALOG_BASE}/books?${suffix}` : `${CATALOG_BASE}/books`;
  }

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit((page - 1) * size)) {
      throw new BadRequestException(`pagination window is too deep; (page - 1) * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  private normalizeFormat(format: string | null | undefined): string {
    return (format ?? 'bin').toLowerCase();
  }

  private uniqueFormats(formats: string[]): string[] {
    return [...new Set(formats.map((format) => this.normalizeFormat(format)).filter(Boolean))];
  }

  private downloadFilename(detail: BookDetailDto, fileId: number, format: string): string {
    const title = detail.title ?? (basename(detail.folderPath) || `book-${detail.id}`);
    const author = detail.authors[0]?.name;
    const base = [title, author].filter(Boolean).join(' - ');
    const safeBase =
      base
        .replace(/["\\/:*?<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || `book-${detail.id}-file-${fileId}`;
    const ext = extname(safeBase).replace(/^\./, '').toLowerCase();
    if (ext === format) return safeBase;
    return `${safeBase}.${format}`;
  }
}
