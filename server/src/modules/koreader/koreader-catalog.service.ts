import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { DEFAULT_KOREADER_DEVICE_PATTERN, resolveUploadPath } from '@bookorbit/types';
import { buildPatternTokens } from '../../common/utils/pattern-tokens.utils';
import type {
  AchievementItem,
  KoreaderAchievementBadge,
  KoreaderAchievementSummary,
  KoreaderCatalogAuthorSummary,
  KoreaderCatalogBookDetail,
  KoreaderCatalogBookListItem,
  KoreaderCatalogBrowseCounts,
  KoreaderCatalogDashboardResponse,
  KoreaderYearAgo,
  KoreaderCatalogDashboardSection,
  KoreaderCatalogDashboardSectionResponse,
  KoreaderCatalogDiscoverResponse,
  KoreaderDashboardSectionConfig,
  KoreaderCatalogEntry,
  KoreaderCatalogFile,
  KoreaderCatalogManifestBook,
  KoreaderCatalogManifestFile,
  KoreaderCatalogManifestPage,
  KoreaderCatalogJumpBucket,
  KoreaderCatalogPage,
  KoreaderCatalogPreviewBook,
  KoreaderCatalogProgress,
  KoreaderCatalogRatingResult,
  KoreaderCatalogReadStatusResult,
  KoreaderCatalogRelatedBook,
  KoreaderCatalogRelatedSection,
  KoreaderCatalogSeriesMember,
  KoreaderCatalogSection,
  KoreaderCatalogSectionFilter,
  KoreaderCatalogSectionResponse,
  KoreaderCatalogSectionSort,
  KoreaderCatalogSeriesSummary,
  KoreaderCatalogSettableReadStatus,
  KoreaderCatalogSort,
  KoreaderCatalogSortOrder,
} from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DeliverySelectionService } from '../book/delivery-selection.service';
import type { ReadAloudDeliveryVariant } from '@bookorbit/types';
import { BookReadService } from '../book/book-read.service';
import { BookService } from '../book/book.service';
import { BrowseCountsService } from '../browse-counts/browse-counts.service';
import type { BookDetailDto } from '../book/dto/book-detail.dto';
import { DashboardService } from '../dashboard/dashboard.service';
import { DashboardWidgetService } from '../dashboard/dashboard-widget.service';
import { AchievementService } from '../achievement/achievement.service';
import { AuthorImageStorageService } from '../authors/author-image-storage.service';
import { fileMimeType } from '../opds/opds-xml.helpers';
import { OpdsBookEntry, OpdsBookService } from '../opds/opds-book.service';
import type {
  CatalogBucketSortOrder,
  CatalogVisibilityOptions,
  OpdsBookSummary,
  OpdsManifestBookRow,
  OpdsPreviewBookRow,
  OpdsVisibleAuthor,
} from '../opds/opds-book.service';
import { RecommendationService } from '../recommendation/recommendation.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { KoreaderCatalogBooksQueryDto, KoreaderCatalogManifestQueryDto } from './dto/koreader-catalog-query.dto';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { KoreaderPluginService } from './koreader-plugin.service';
import { KoreaderService } from './koreader.service';

type OpdsSortOrder = Parameters<OpdsBookService['getBooksPage']>[1];
type BookProgressRow = Awaited<ReturnType<BookReadService['findProgressByBook']>>[number];
type ProgressCandidate = BookProgressRow & { percentage: number; updatedAt: Date };
type BatchProgressRow = Awaited<ReturnType<BookReadService['findProgressByBooks']>>[number];
type BatchProgressCandidate = BatchProgressRow & { percentage: number; updatedAt: Date };
type CatalogBookFilters = ReturnType<KoreaderCatalogService['buildBookFilters']>;
// The progress a book shows, plus when it was last opened: reading_progress.last_read_at
// moves on every open, updated_at only when the position does.
type CatalogProgress = KoreaderCatalogProgress & { lastReadAt: string };
// What this reader asked the plugin to leave out, resolved once per request.
type CatalogVisibility = { excludeAudioOnly: boolean };
// For lists that record what the reader did rather than offer what to read next.
const EVERY_BOOK: CatalogVisibility = { excludeAudioOnly: false };

function latestDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}
function toBadge(item: AchievementItem): KoreaderAchievementBadge {
  return {
    key: item.key,
    groupKey: item.groupKey,
    name: item.name,
    description: item.description,
    rarity: item.rarity,
    iconName: item.iconName,
    threshold: item.threshold,
    currentProgress: item.currentProgress,
    awardedAt: item.awardedAt,
  };
}

type PreviewState = { progress: Map<number, CatalogProgress>; status: Map<number, { status: string }> };
type ShelfExtras = { total: number; readingCount: number; previewBooks: KoreaderCatalogPreviewBook[] };

export interface KoreaderCatalogSectionQuery {
  page?: number;
  offset?: number;
  q?: string;
  size?: number;
  sort?: KoreaderCatalogSectionSort;
  filter?: KoreaderCatalogSectionFilter;
}

const CATALOG_BASE = '/api/v1/koreader/plugin/catalog';
const AUTHOR_SERIES_PAGE_SIZE = 60;
const PREVIEW_BOOK_LIMIT = 3;
// A reader has a handful of shelves; past this many the list still renders,
// just without covers and reading counts.
const SHELF_EXTRAS_LIMIT = 50;
const SHELF_EXTRAS_CONCURRENCY = 4;
const DASHBOARD_CONTINUE_READING_LIMIT = 5;
// 53 weeks: enough for the plugin's 52-week heatmap whatever weekday today is.
const DASHBOARD_READING_YEAR_DAYS = 371;
const YEAR_AGO_CANDIDATES = 5;
const DASHBOARD_FINISHED_LIMIT = 12;
const DASHBOARD_DISCOVER_LIMIT = 12;
const DASHBOARD_SECTION_LIMIT = 12;
const DETAIL_RELATED_LIMIT = 8;
const MANIFEST_DEFAULT_PAGE_SIZE = 100;
const MANIFEST_CURSOR_VERSION = 1;
const MANIFEST_CURSOR_CONTRACT_CHANGED = Symbol('manifest-cursor-contract-changed');

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
  private readonly logger = new Logger(KoreaderCatalogService.name);

  constructor(
    private readonly opdsBookService: OpdsBookService,
    private readonly bookService: BookService,
    private readonly bookReadService: BookReadService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly dashboardService: DashboardService,
    private readonly dashboardWidgetService: DashboardWidgetService,
    private readonly browseCountsService: BrowseCountsService,
    private readonly recommendationService: RecommendationService,
    private readonly appSettingsService: AppSettingsService,
    private readonly koreaderService: KoreaderService,
    private readonly pluginService: KoreaderPluginService,
    private readonly authorImageStorage: AuthorImageStorageService,
    @Optional() private readonly deliverySelection?: DeliverySelectionService,
    @Optional() private readonly achievementService?: AchievementService,
  ) {}

  getRoot(): { sections: KoreaderCatalogEntry[] } {
    return { sections: ROOT_SECTIONS.map((section) => ({ ...section })) };
  }

  async getDashboard(user: RequestUser, section?: KoreaderDashboardSectionConfig): Promise<KoreaderCatalogDashboardResponse> {
    const visibility = await this.resolveVisibility(user);
    const continueReadingQuery = Object.assign(new KoreaderCatalogBooksQueryDto(), {
      page: 1,
      size: DASHBOARD_CONTINUE_READING_LIMIT,
      sort: 'recently_read' as const,
      readStatus: 'reading' as const,
    });

    const [
      continueReading,
      discover,
      dashboardSection,
      readingGoal,
      readingStreak,
      highlightOfTheDay,
      totalBooks,
      browseCounts,
      readingYear,
      yearAgo,
      finishedThisYear,
      achievements,
    ] = await Promise.all([
      this.loadBooksPage(user, continueReadingQuery, visibility),
      section ? Promise.resolve<KoreaderCatalogBookListItem[]>([]) : this.buildDiscover(user, visibility),
      section ? this.buildDashboardSection(user, section, visibility) : Promise.resolve(undefined),
      this.dashboardWidgetService.getReadingGoal(user),
      this.dashboardWidgetService.getReadingStreak(user),
      this.dashboardWidgetService.getHighlightOfTheDay(user),
      this.countBooks(user, {}, visibility),
      this.buildBrowseCounts(user, visibility),
      this.dashboardWidgetService.getReadingDays(user, DASHBOARD_READING_YEAR_DAYS),
      // The year-ago card and the finished shelf are the reader's history, which the reading goal
      // beside them counts in full, so they keep audiobook-only books.
      this.buildYearAgo(user),
      this.buildFinishedThisYear(user),
      this.buildAchievementSummary(user),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      username: user.username,
      displayName: user.name || user.username,
      totalBooks,
      browseCounts,
      sections: ROOT_SECTIONS.map((rootSection) => ({ ...rootSection })),
      continueReading: continueReading.items,
      discover,
      ...(dashboardSection ? { section: dashboardSection } : {}),
      readingGoal,
      readingStreak,
      highlightOfTheDay,
      readingYear,
      yearAgo,
      finishedThisYear,
      achievements,
    };
  }

  // The device board's Next badge widget: earned of total, the unearned badge
  // closest to done and the badge earned last. Null when the reader turned
  // achievements off; a failure here never fails the dashboard.
  private async buildAchievementSummary(user: RequestUser): Promise<KoreaderAchievementSummary | null> {
    const preferences = (user.settings as { achievementPreferences?: { enabled?: unknown } } | undefined)?.achievementPreferences;
    if (!this.achievementService || preferences?.enabled === false) return null;
    const startedAtMs = Date.now();
    try {
      const catalogue = await this.achievementService.getCatalogue(user);
      const items = catalogue.categories.flatMap((category) => category.achievements);
      let next: AchievementItem | null = null;
      let nextRatio = -1;
      let latest: AchievementItem | null = null;
      for (const item of items) {
        if (item.earned) {
          if (item.awardedAt && (!latest || (latest.awardedAt ?? '') < item.awardedAt)) latest = item;
          continue;
        }
        if (item.hidden || !item.threshold || item.currentProgress === null) continue;
        const ratio = item.currentProgress / item.threshold;
        if (ratio < 1 && ratio > nextRatio) {
          next = item;
          nextRatio = ratio;
        }
      }
      return { earned: catalogue.totalEarned, total: catalogue.totalAvailable, next: next && toBadge(next), latest: latest && toBadge(latest) };
    } catch (error) {
      this.logger.warn(
        `[koreader.dashboard.achievements] [fail] userId=${user.id} durationMs=${Date.now() - startedAtMs} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - achievement summary skipped`,
      );
      return null;
    }
  }

  private async buildFinishedThisYear(user: RequestUser): Promise<KoreaderCatalogBookListItem[]> {
    const finished = await this.dashboardWidgetService.getFinishedThisYear(user, DASHBOARD_FINISHED_LIMIT);
    const finishedOn = new Map(finished.map((entry) => [entry.bookId, entry.finishedOn]));
    const items = await this.loadBookListItemsByIds(
      user,
      finished.map((entry) => entry.bookId),
      EVERY_BOOK,
    );
    return items.map((item) => ({ ...item, finishedOn: finishedOn.get(item.id) ?? null }));
  }

  // The first of the year-ago candidates this reader can still open.
  private async buildYearAgo(user: RequestUser): Promise<KoreaderYearAgo | null> {
    const candidates = await this.dashboardWidgetService.getYearAgoCandidates(user, YEAR_AGO_CANDIDATES);
    if (candidates.length === 0) return null;
    const items = await this.loadBookListItemsByIds(
      user,
      candidates.map((candidate) => candidate.bookId),
      EVERY_BOOK,
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const candidate of candidates) {
      const book = byId.get(candidate.bookId);
      if (!book) continue;
      return {
        book,
        minutes: Math.round(candidate.seconds / 60),
        days: candidate.days,
        endProgress: candidate.endProgress,
        firstDay: candidate.firstDay,
        lastDay: candidate.lastDay,
      };
    }
    return null;
  }

  async getDiscover(user: RequestUser): Promise<KoreaderCatalogDiscoverResponse> {
    return { discover: await this.buildDiscover(user, await this.resolveVisibility(user)) };
  }

  async getDashboardSection(user: RequestUser, section: KoreaderDashboardSectionConfig): Promise<KoreaderCatalogDashboardSectionResponse> {
    return { section: await this.buildDashboardSection(user, section, await this.resolveVisibility(user)) };
  }

  private async buildDashboardSection(
    user: RequestUser,
    section: KoreaderDashboardSectionConfig,
    visibility: CatalogVisibility,
  ): Promise<KoreaderCatalogDashboardSection> {
    return {
      type: section.type,
      smartScopeId: section.smartScopeId ?? null,
      books: await this.buildSectionBooks(user, section, visibility),
    };
  }

  private async buildSectionBooks(
    user: RequestUser,
    section: KoreaderDashboardSectionConfig,
    visibility: CatalogVisibility,
  ): Promise<KoreaderCatalogBookListItem[]> {
    // Random keeps its original implementation so the row and its reroll stay
    // byte-for-byte what the Discover row already returned.
    if (section.type === 'random') return this.buildDiscover(user, visibility);

    // Narrowed in the selection itself, so a row of audiobooks cannot crowd out the books behind it.
    const narrowing = this.narrowing(visibility);
    const bookIds =
      section.type === 'smart-scope'
        ? await this.dashboardService.getSmartScopeBookIds(section.smartScopeId, user, DASHBOARD_SECTION_LIMIT, narrowing)
        : await this.dashboardService.getScrollerBookIds(section.type, user, DASHBOARD_SECTION_LIMIT, narrowing);

    return this.loadBookListItemsByIds(user, bookIds, visibility);
  }

  // Selection order carries the section's meaning (series position, recency), so
  // it is restored after the books query re-sorts by its own criteria.
  private async loadBookListItemsByIds(user: RequestUser, bookIds: number[], visibility: CatalogVisibility): Promise<KoreaderCatalogBookListItem[]> {
    if (bookIds.length === 0) return [];
    const query = Object.assign(new KoreaderCatalogBooksQueryDto(), { page: 1, size: bookIds.length, ids: bookIds });
    const { items } = await this.loadBooksPage(user, query, visibility);
    const byId = new Map(items.map((item) => [item.id, item]));
    return bookIds.map((id) => byId.get(id)).filter((item): item is KoreaderCatalogBookListItem => item !== undefined);
  }

  private async buildDiscover(user: RequestUser, visibility: CatalogVisibility): Promise<KoreaderCatalogBookListItem[]> {
    const entries = await this.opdsBookService.getRandomBooks(
      user.id,
      DASHBOARD_DISCOVER_LIMIT,
      user.isSuperuser,
      user.contentFilters,
      this.narrowing(visibility),
    );
    if (entries.length === 0) return [];

    const bookIds = entries.map((entry) => entry.id);
    const [progressMap, statusMap] = await Promise.all([
      this.findBestProgressMap(user.id, bookIds),
      this.userBookStatusService.findByBookIds(user.id, bookIds),
    ]);
    return entries.map((entry) => this.mapBookListItem(entry, progressMap.get(entry.id) ?? null, statusMap.get(entry.id)?.status ?? null));
  }

  async getSectionEntries(user: RequestUser, section: string, query: KoreaderCatalogSectionQuery = {}): Promise<KoreaderCatalogSectionResponse> {
    switch (section) {
      case 'libraries':
        return { section, items: await this.getLibraryEntries(user, await this.resolveVisibility(user)) };
      case 'collections':
        return { section, items: await this.getCollectionEntries(user, await this.resolveVisibility(user)) };
      case 'smart-scopes':
        return { section, items: await this.getSmartScopeEntries(user, await this.resolveVisibility(user)) };
      case 'authors':
        return this.getAuthorsSection(user, query, await this.resolveVisibility(user));
      case 'series':
        return this.getSeriesSection(user, query, await this.resolveVisibility(user));
      default:
        throw new BadRequestException('Unknown catalog section');
    }
  }

  async getBooksPage(user: RequestUser, query: KoreaderCatalogBooksQueryDto): Promise<KoreaderCatalogPage<KoreaderCatalogBookListItem>> {
    return this.loadBooksPage(user, query, await this.resolveVisibility(user));
  }

  private async loadBooksPage(
    user: RequestUser,
    query: KoreaderCatalogBooksQueryDto,
    visibility: CatalogVisibility,
  ): Promise<KoreaderCatalogPage<KoreaderCatalogBookListItem>> {
    const size = query.size ?? 20;
    const offset = query.offset ?? ((query.page ?? 1) - 1) * size;
    const page = Math.floor(offset / size) + 1;
    this.assertPaginationWindow(offset);

    const filters = this.buildBookFilters(query, visibility);
    const sort = this.mapSort(query.sort ?? 'recently_added', query.order);
    const bucketSort = query.buckets === true ? this.bucketSortOrder(sort) : null;
    const [{ entries, total }, buckets, author] = await Promise.all([
      query.offset !== undefined
        ? this.opdsBookService.getBooksPage(user.id, sort, page, size, filters, user.isSuperuser, user.contentFilters, offset)
        : this.opdsBookService.getBooksPage(user.id, sort, page, size, filters, user.isSuperuser, user.contentFilters),
      bucketSort
        ? this.opdsBookService.getBookJumpBuckets(user.id, bucketSort, filters, user.isSuperuser, user.contentFilters)
        : Promise.resolve(null),
      filters.author
        ? this.opdsBookService.findVisibleAuthor(user.id, { name: filters.author }, user.isSuperuser, user.contentFilters)
        : Promise.resolve(undefined),
    ]);

    const bookIds = entries.map((entry) => entry.id);
    const [progressMap, statusMap, seriesSummary] = await Promise.all([
      this.findBestProgressMap(user.id, bookIds),
      this.userBookStatusService.findByBookIds(user.id, bookIds),
      filters.seriesId !== undefined || filters.series ? this.computeSeriesSummary(user, filters) : Promise.resolve(null),
    ]);

    const items = entries.map((entry) => this.mapBookListItem(entry, progressMap.get(entry.id) ?? null, statusMap.get(entry.id)?.status ?? null));
    return {
      ...this.paginate(items, total, page, size, query, seriesSummary, query.offset !== undefined ? offset : undefined),
      ...(buckets ? { buckets } : {}),
      ...(author !== undefined ? { authorSummary: author ? this.mapAuthorSummary(author) : null } : {}),
    };
  }

  // Only the letter-ordered sorts have a jump rail; every other sort is a
  // date or a series position.
  private bucketSortOrder(sort: OpdsSortOrder): CatalogBucketSortOrder | null {
    return sort === 'title_asc' || sort === 'title_desc' || sort === 'author_asc' || sort === 'author_desc' ? sort : null;
  }

  private mapAuthorSummary(author: OpdsVisibleAuthor): KoreaderCatalogAuthorSummary {
    return {
      id: author.id,
      name: author.name,
      description: author.description,
      birthYear: author.birthYear,
      deathYear: author.deathYear,
      hasPhoto: author.hasPhoto,
      photoUrl: this.authorPhotoUrl(author.id, author.hasPhoto),
    };
  }

  private authorPhotoUrl(authorId: number, hasPhoto: boolean): string | null {
    return hasPhoto ? `${CATALOG_BASE}/authors/${authorId}/photo` : null;
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

  // Bulk download enumeration. One page carries everything selection and
  // transfer need, so a bulk run performs no per-book detail request and no
  // per-file match request.
  async getBulkManifest(user: RequestUser, query: KoreaderCatalogManifestQueryDto): Promise<KoreaderCatalogManifestPage> {
    const size = query.size ?? MANIFEST_DEFAULT_PAGE_SIZE;
    const filters = this.buildBookFilters(query, await this.resolveVisibility(user));
    const filterKey = this.manifestFilterKey(query, filters);
    const manifestVersion = await this.pluginService.getLibraryVersion(user.id);

    let afterId: number | undefined;
    // The version the run started against, carried forward so every cursor of a run
    // stays bound to one snapshot identity.
    let runVersion = manifestVersion;
    if (query.cursor) {
      const cursor = this.decodeManifestCursor(query.cursor);
      if (cursor === MANIFEST_CURSOR_CONTRACT_CHANGED) {
        return { items: [], hasNext: false, nextCursor: null, manifestVersion, restartRequired: true };
      }
      if (cursor.userId !== user.id || cursor.filterKey !== filterKey) {
        throw new BadRequestException('manifest cursor does not match this request');
      }
      // A version change no longer restarts enumeration. The keyset orders by immutable
      // book id, so a concurrent insert or delete can neither skip nor duplicate a row,
      // and restarting during a live import would refetch every earlier page. The new
      // version travels in the response instead, which is what refreshes match state.
      runVersion = cursor.manifestVersion;
      afterId = cursor.afterId;
    }

    const { rows, hasNext } = await this.opdsBookService.getBookManifestPage(
      user.id,
      { filters, afterId, limit: size },
      user.isSuperuser,
      user.contentFilters,
    );

    const [userDefaultPattern, deviceOrganization, sanitizeForCrossPlatform] = await Promise.all([
      this.koreaderService.getKoreaderUserDefaultPattern(user.id),
      query.deviceId ? this.koreaderService.getDeviceFileNamingPattern(user.id, query.deviceId) : Promise.resolve(null),
      this.appSettingsService.isCrossPlatformPathSanitizationEnabled(),
    ]);
    const defaultPattern = deviceOrganization?.fileNamingPattern?.trim() || userDefaultPattern?.trim() || DEFAULT_KOREADER_DEVICE_PATTERN;

    const items = rows.map((row) => {
      const groupedPattern = row.seriesName
        ? deviceOrganization?.seriesFileNamingPattern?.trim() || ''
        : deviceOrganization?.standaloneFileNamingPattern?.trim() || '';
      const pattern = groupedPattern || defaultPattern;
      return this.mapManifestBook(row, pattern, sanitizeForCrossPlatform, query.variant, user.id);
    });

    if (query.variant)
      await this.enrichDeliveryFiles(
        user.id,
        items.flatMap((item) => item.files),
      );

    const lastId = rows.length > 0 ? rows[rows.length - 1]!.id : afterId;
    return {
      items,
      hasNext,
      nextCursor: hasNext && lastId !== undefined ? this.encodeManifestCursor(user.id, filterKey, runVersion, lastId) : null,
      manifestVersion,
      restartRequired: false,
    };
  }

  private mapManifestBook(
    row: OpdsManifestBookRow,
    pattern: string,
    sanitizeForCrossPlatform: boolean,
    variant?: ReadAloudDeliveryVariant,
    userId?: number,
  ): KoreaderCatalogManifestBook {
    const files = row.files.map<KoreaderCatalogManifestFile>((file) => {
      const extension = this.normalizeFormat(file.format);
      const downloadVariant =
        extension === 'epub' && variant !== 'original' && (file.mediaOverlayAvailable || variant === 'audioless_epub')
          ? 'audioless_epub'
          : 'original';
      const hasSameFormatSibling = row.files.some((candidate) => candidate.id !== file.id && this.normalizeFormat(candidate.format) === extension);
      const devicePath =
        resolveUploadPath(
          pattern,
          buildPatternTokens({
            metadata: {
              title: row.title,
              subtitle: row.subtitle,
              publisher: row.publisher,
              language: row.language,
              isbn13: row.isbn13,
              isbn10: row.isbn10,
              publishedYear: row.publishedYear,
              seriesName: row.seriesName,
              seriesIndex: row.seriesIndex,
            },
            authors: row.authors,
            originalStem: basename(file.filename ?? row.title, `.${extension}`),
            format: extension,
            libraryName: row.libraryName,
          }),
          extension,
          { sanitizeForCrossPlatform },
        ) ??
        file.filename ??
        `${row.title}.${extension}`;
      return {
        id: file.id,
        format: extension,
        downloadVariant,
        sizeBytes: downloadVariant === 'audioless_epub' ? null : file.sizeBytes,
        contentVersion: file.contentVersion.toISOString(),
        fileHash: downloadVariant === 'audioless_epub' ? null : file.fileHash,
        requestedVariant: variant,
        sourceMediaOverlayAvailable: file.mediaOverlayAvailable,
        narrationPlaybackAvailable: downloadVariant === 'original' && file.mediaOverlayAvailable,
        selection:
          variant && userId ? this.deliverySelection?.descriptor(userId, 'koreader', file.id, variant, file.contentVersion.toISOString()) : undefined,
        downloadUrl: this.downloadUrl(file.id, variant, userId, file.contentVersion.toISOString()),
        devicePath: this.variantDevicePath(devicePath, downloadVariant, hasSameFormatSibling, variant ? file.id : undefined),
      };
    });

    return {
      id: row.id,
      title: row.title,
      authors: row.authors,
      seriesName: row.seriesName,
      seriesIndex: row.seriesIndex,
      formats: this.uniqueFormats(files.map((file) => file.format)),
      files,
    };
  }

  // Identifies the normalized filter a cursor was minted against, so a cursor
  // can never be replayed against a different selection. The audio-only setting
  // stays out of it, as content filters do: it is account state, so a run that
  // sees it change carries on under the new value instead of failing.
  private manifestFilterKey(query: KoreaderCatalogManifestQueryDto, filters: ReturnType<KoreaderCatalogService['buildBookFilters']>): string {
    const parts = [
      `ids=${filters.ids ? [...filters.ids].sort((a, b) => a - b).join('.') : ''}`,
      `library=${filters.libraryId ?? ''}`,
      `collection=${filters.collectionId ?? ''}`,
      `smartScope=${filters.smartScopeId ?? ''}`,
      `author=${filters.author ?? ''}`,
      `series=${filters.series ?? ''}`,
      `seriesId=${filters.seriesId ?? ''}`,
      `q=${filters.q ?? ''}`,
      `readStatus=${filters.readStatus ?? ''}`,
      `format=${filters.format ?? ''}`,
      `device=${query.deviceId ?? ''}`,
      ...(query.variant ? [`variant=${query.variant}`] : []),
    ];
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  }

  private encodeManifestCursor(userId: number, filterKey: string, manifestVersion: string, afterId: number): string {
    const payload = { v: MANIFEST_CURSOR_VERSION, u: userId, k: filterKey, m: manifestVersion, a: afterId };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * Returns the decoded cursor, or the contract-changed marker when the payload is a
   * well-formed cursor from another cursor contract. That is the one case left where the
   * client has to restart enumeration; a moved manifest snapshot no longer is.
   */
  private decodeManifestCursor(
    cursor: string,
  ): { userId: number; filterKey: string; manifestVersion: string; afterId: number } | typeof MANIFEST_CURSOR_CONTRACT_CHANGED {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('invalid manifest cursor');
    }
    const value = payload as { v?: unknown; u?: unknown; k?: unknown; m?: unknown; a?: unknown };
    if (typeof value?.v === 'number' && value.v !== MANIFEST_CURSOR_VERSION) {
      return MANIFEST_CURSOR_CONTRACT_CHANGED;
    }
    if (
      value?.v !== MANIFEST_CURSOR_VERSION ||
      typeof value.u !== 'number' ||
      typeof value.k !== 'string' ||
      typeof value.m !== 'string' ||
      typeof value.a !== 'number' ||
      !Number.isInteger(value.a)
    ) {
      throw new BadRequestException('invalid manifest cursor');
    }
    return { userId: value.u, filterKey: value.k, manifestVersion: value.m, afterId: value.a };
  }

  async getBookDetail(user: RequestUser, bookId: number, deviceId?: string, variant?: ReadAloudDeliveryVariant): Promise<KoreaderCatalogBookDetail> {
    const [detail, related, userDefaultPattern, sanitizeForCrossPlatform] = await Promise.all([
      this.bookService.getDetail(bookId, user),
      this.resolveVisibility(user).then((visibility) => this.buildRelatedSections(user, bookId, visibility)),
      this.koreaderService.getKoreaderUserDefaultPattern(user.id),
      this.appSettingsService.isCrossPlatformPathSanitizationEnabled(),
    ]);
    const [progress, deviceOrganization] = await Promise.all([
      this.findBestProgress(user.id, detail.id),
      deviceId ? this.koreaderService.getDeviceFileNamingPattern(user.id, deviceId) : Promise.resolve(null),
    ]);
    const effectiveDefaultPattern = deviceOrganization?.fileNamingPattern?.trim() || userDefaultPattern?.trim() || DEFAULT_KOREADER_DEVICE_PATTERN;
    const groupedPattern = detail.seriesName
      ? deviceOrganization?.seriesFileNamingPattern?.trim() || ''
      : deviceOrganization?.standaloneFileNamingPattern?.trim() || '';
    const selectedPattern = groupedPattern.trim() || effectiveDefaultPattern;
    const mapped = this.mapBookDetail(detail, progress, related.sections, selectedPattern, sanitizeForCrossPlatform, variant, user.id);
    mapped.seriesMembers = related.seriesMembers;
    if (variant) await this.enrichDeliveryFiles(user.id, mapped.files);
    return mapped;
  }

  async streamThumbnail(user: RequestUser, bookId: number, reply: FastifyReply, ifNoneMatch?: string): Promise<void> {
    const thumbnailPath = await this.bookService.getThumbnailPath(bookId, user, { medium: 'ebook' });
    if (!thumbnailPath) throw new NotFoundException('No thumbnail');
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

  // The photo is served only for an author this reader can reach through a
  // visible book, so the route cannot be used to enumerate the author table.
  async streamAuthorPhoto(user: RequestUser, authorId: number, reply: FastifyReply, ifNoneMatch?: string): Promise<void> {
    const author = await this.opdsBookService.findVisibleAuthor(user.id, { id: authorId }, user.isSuperuser, user.contentFilters);
    if (!author?.hasPhoto) throw new NotFoundException('No author photo');
    const photoPath = await this.authorImageStorage.getThumbnailPath(authorId);
    if (!photoPath) throw new NotFoundException('No author photo');
    try {
      const { mtimeMs } = await stat(photoPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(photoPath));
    } catch {
      throw new NotFoundException('No author photo');
    }
  }

  async streamFile(user: RequestUser, fileId: number, reply: FastifyReply, variant?: ReadAloudDeliveryVariant, selection?: string): Promise<void> {
    const file = await this.bookService.verifyFileAccess(fileId, user);
    if (file.role !== 'content') {
      throw new NotFoundException('File not found');
    }

    if (variant) {
      if (!this.deliverySelection) throw new InternalServerErrorException({ code: 'DELIVERY_UNAVAILABLE' });
      const artifact = await this.deliverySelection.prepare(user.id, 'koreader', file, variant, selection, file.updatedAt.toISOString());
      const filename = await this.bookService.resolveDownloadFilename({
        ...file,
        mediaOverlayAvailable: artifact.actualVariant === 'original' && file.mediaOverlayAvailable,
      });
      return this.deliverySelection.stream(artifact, filename, fileMimeType(this.normalizeFormat(file.format)), reply);
    }

    if (file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable === true) {
      try {
        const result = await this.bookService.createAudiolessEpubDownload(fileId, user, { linkKoreaderHash: true });
        const stream = createReadStream(result.path);
        stream.once('close', () => {
          void result.cleanup();
        });
        reply.header('Content-Disposition', contentDispositionHeader('attachment', result.filename, 'download'));
        reply.header('Content-Length', result.size);
        reply.type('application/epub+zip');
        reply.send(stream);
        return;
      } catch (err) {
        const errorClass = err instanceof Error ? err.name : 'Error';
        const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
        this.logger.warn(
          `[koreader.stream_file] [fail] fileId=${fileId} userId=${user.id} errorClass=${errorClass} error="${errorMessage}" - audioless rebuild failed`,
        );
        throw new InternalServerErrorException('Unable to create audio-free EPUB');
      }
    }
    const format = this.normalizeFormat(file.format);
    const filename = await this.bookService.resolveDownloadFilename({
      bookId: file.bookId,
      absolutePath: file.absolutePath,
      format: file.format,
      mediaOverlayAvailable: false,
    });

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

  private async getLibraryEntries(user: RequestUser, visibility: CatalogVisibility): Promise<KoreaderCatalogEntry[]> {
    const accessible = await this.opdsBookService.getAccessibleLibraries(user.id, user.isSuperuser);
    // A library of nothing but audiobooks would only ever open empty, so it goes too.
    const audioOnly = visibility.excludeAudioOnly
      ? new Set(await this.opdsBookService.findAudioOnlyLibraryIds(accessible.map((row) => row.id)))
      : new Set<number>();
    const rows = accessible.filter((row) => !audioOnly.has(row.id));
    const extras = await this.loadShelfExtras(
      user,
      rows.map((row) => ({ libraryId: row.id })),
      visibility,
    );
    return Promise.all(
      rows.map(async (row, index) => {
        const shelf = extras[index];
        return {
          id: String(row.id),
          title: row.name,
          section: 'libraries' as const,
          count: shelf ? shelf.total : await this.countBooks(user, { libraryId: row.id }, visibility),
          booksHref: this.booksHref({ libraryId: row.id, sort: 'title' }),
          ...(shelf ? { readingCount: shelf.readingCount, previewBooks: shelf.previewBooks } : {}),
        };
      }),
    );
  }

  private async getCollectionEntries(user: RequestUser, visibility: CatalogVisibility): Promise<KoreaderCatalogEntry[]> {
    const rows = await this.opdsBookService.getUserCollections(user.id, user.isSuperuser, user.contentFilters, this.narrowing(visibility));
    const extras = await this.loadShelfExtras(
      user,
      rows.map((row) => ({ collectionId: row.id })),
      visibility,
    );
    return rows.map((row, index) => {
      const shelf = extras[index];
      return {
        id: String(row.id),
        title: row.name,
        section: 'collections',
        count: row.bookCount,
        booksHref: this.booksHref({ collectionId: row.id, sort: 'title' }),
        ...(shelf ? { readingCount: shelf.readingCount, previewBooks: shelf.previewBooks } : {}),
      };
    });
  }

  private async getSmartScopeEntries(user: RequestUser, visibility: CatalogVisibility): Promise<KoreaderCatalogEntry[]> {
    const rows = await this.opdsBookService.getUserSmartScopes(user.id);
    const extras = await this.loadShelfExtras(
      user,
      rows.map((row) => ({ smartScopeId: row.id })),
      visibility,
    );
    return rows.map((row, index) => {
      const shelf = extras[index];
      return {
        id: String(row.id),
        title: row.name,
        section: 'smart-scopes',
        icon: row.icon ?? null,
        booksHref: this.booksHref({ smartScopeId: row.id, sort: 'title' }),
        ...(shelf ? { count: shelf.total, readingCount: shelf.readingCount, previewBooks: shelf.previewBooks } : {}),
      };
    });
  }

  // Cover strip and counts per shelf. Shelves past the cap, and any shelf whose
  // scope refuses this reader, come back as null and render as a plain row.
  private async loadShelfExtras(user: RequestUser, scopes: CatalogBookFilters[], visibility: CatalogVisibility): Promise<(ShelfExtras | null)[]> {
    const summaries = await mapWithConcurrency(scopes.slice(0, SHELF_EXTRAS_LIMIT), SHELF_EXTRAS_CONCURRENCY, (filters) =>
      this.opdsBookService
        .summarizeBooks(user.id, { ...filters, ...this.narrowing(visibility) }, PREVIEW_BOOK_LIMIT, user.isSuperuser, user.contentFilters)
        .catch((error: unknown): OpdsBookSummary | null => {
          if (error instanceof ForbiddenException) return null;
          throw error;
        }),
    );
    const state = await this.loadPreviewState(
      user,
      summaries.flatMap((summary) => summary?.previews.map((preview) => preview.id) ?? []),
    );
    return scopes.map((_, index) => {
      const summary = summaries[index];
      if (!summary) return null;
      return {
        total: summary.total,
        readingCount: summary.reading,
        previewBooks: summary.previews.map((preview) => this.mapPreviewBook(preview, state)),
      };
    });
  }

  private async loadPreviewState(user: RequestUser, bookIds: number[]): Promise<PreviewState> {
    const ids = [...new Set(bookIds)];
    if (ids.length === 0) return { progress: new Map(), status: new Map() };
    const [progress, status] = await Promise.all([this.findBestProgressMap(user.id, ids), this.userBookStatusService.findByBookIds(user.id, ids)]);
    return { progress, status };
  }

  private mapPreviewBook(row: OpdsPreviewBookRow, state: PreviewState): KoreaderCatalogPreviewBook {
    const progress = state.progress.get(row.id) ?? null;
    return {
      id: row.id,
      title: row.title,
      hasCover: row.hasCover,
      thumbnailUrl: row.hasCover ? `${CATALOG_BASE}/books/${row.id}/thumbnail` : null,
      seriesIndex: row.seriesIndex,
      progressPercentage: progress?.percentage ?? null,
      readStatus: state.status.get(row.id)?.status ?? null,
      lastReadAt: progress?.lastReadAt ?? null,
      addedAt: row.addedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async getAuthorsSection(
    user: RequestUser,
    query: KoreaderCatalogSectionQuery,
    visibility: CatalogVisibility,
  ): Promise<KoreaderCatalogSectionResponse> {
    const size = query.size ?? AUTHOR_SERIES_PAGE_SIZE;
    const sort = query.sort ?? 'name';
    const offset = query.offset ?? ((query.page ?? 1) - 1) * size;
    const page = Math.floor(offset / size) + 1;
    const { items, hasNext, total, buckets } = await this.opdsBookService.getDistinctAuthorsPage(
      user.id,
      { q: query.q, limit: size, offset, sort, filter: query.filter, ...this.narrowing(visibility) },
      user.isSuperuser,
      user.contentFilters,
    );
    const state = await this.loadPreviewState(
      user,
      items.flatMap((row) => row.previews.map((preview) => preview.id)),
    );
    const entries: KoreaderCatalogEntry[] = items.map((row) => ({
      id: row.name,
      title: row.name,
      section: 'authors',
      count: row.bookCount,
      booksHref: this.booksHref({ author: row.name, sort: 'title' }),
      authorId: row.id,
      hasPhoto: row.hasPhoto,
      photoUrl: this.authorPhotoUrl(row.id, row.hasPhoto),
      readingCount: row.readingCount,
      finishedCount: row.finishedCount,
      seriesName: row.seriesName,
      previewBooks: row.previews.map((preview) => this.mapPreviewBook(preview, state)),
      letter: row.letter,
    }));
    return this.buildListSectionPage('authors', entries, page, hasNext, query, { total, size, sort, buckets });
  }

  private async getSeriesSection(
    user: RequestUser,
    query: KoreaderCatalogSectionQuery,
    visibility: CatalogVisibility,
  ): Promise<KoreaderCatalogSectionResponse> {
    const size = query.size ?? AUTHOR_SERIES_PAGE_SIZE;
    const sort = query.sort ?? 'name';
    const offset = query.offset ?? ((query.page ?? 1) - 1) * size;
    const page = Math.floor(offset / size) + 1;
    const { items, hasNext, total, buckets } = await this.opdsBookService.getDistinctSeriesPage(
      user.id,
      { q: query.q, limit: size, offset, sort, filter: query.filter, ...this.narrowing(visibility) },
      user.isSuperuser,
      user.contentFilters,
    );
    const state = await this.loadPreviewState(
      user,
      items.flatMap((row) => row.previews.map((preview) => preview.id)),
    );
    const entries: KoreaderCatalogEntry[] = items.map((row) => ({
      id: this.seriesEntryId(row.id),
      title: row.name,
      section: 'series',
      count: row.bookCount,
      seriesId: row.id,
      booksHref: this.booksHref({ seriesId: row.id, sort: 'series' }),
      authorNames: row.authorNames,
      memberStates: row.memberStates,
      readingCount: row.readingCount,
      finishedCount: row.finishedCount,
      expectedCount: row.expectedCount,
      previewBooks: row.previews.map((preview) => this.mapPreviewBook(preview, state)),
      letter: row.letter,
    }));
    return this.buildListSectionPage('series', entries, page, hasNext, query, { total, size, sort, buckets });
  }

  private seriesEntryId(seriesId: number): string {
    return `series:${seriesId}`;
  }

  private buildListSectionPage(
    section: KoreaderCatalogSection,
    items: KoreaderCatalogEntry[],
    page: number,
    hasNext: boolean,
    query: KoreaderCatalogSectionQuery,
    list: { total: number; size: number; sort: KoreaderCatalogSectionSort; buckets: KoreaderCatalogJumpBucket[] },
  ): KoreaderCatalogSectionResponse {
    return {
      ...this.buildSectionPage(section, items, page, hasNext, query, list.size),
      total: list.total,
      size: list.size,
      sort: list.sort,
      filter: query.filter ?? null,
      ...(list.sort === 'books' ? {} : { buckets: list.buckets }),
    };
  }

  // size is needed only to step an offset-paged request's links.
  private buildSectionPage(
    section: KoreaderCatalogSection,
    items: KoreaderCatalogEntry[],
    page: number,
    hasNext: boolean,
    query: KoreaderCatalogSectionQuery,
    size?: number,
  ): KoreaderCatalogSectionResponse {
    const q = query.q;
    if (query.offset !== undefined && size !== undefined) {
      const hasPrevious = query.offset > 0;
      return {
        section,
        items,
        page,
        offset: query.offset,
        hasNext,
        hasPrevious,
        nextUrl: hasNext ? this.sectionHref(section, page, { ...query, offset: query.offset + size }) : null,
        previousUrl: hasPrevious ? this.sectionHref(section, page, { ...query, offset: Math.max(0, query.offset - size) }) : null,
        query: q?.trim() ? q.trim() : null,
      };
    }
    const hasPrevious = page > 1;
    return {
      section,
      items,
      page,
      hasNext,
      hasPrevious,
      nextUrl: hasNext ? this.sectionHref(section, page + 1, query) : null,
      previousUrl: hasPrevious ? this.sectionHref(section, page - 1, query) : null,
      query: q?.trim() ? q.trim() : null,
    };
  }

  // Carries only the list parameters the request named, so a legacy request
  // keeps producing the links it always did.
  private sectionHref(section: KoreaderCatalogSection, page: number, query: KoreaderCatalogSectionQuery): string {
    const search = new URLSearchParams();
    if (query.offset !== undefined) search.set('offset', String(query.offset));
    else if (page > 1) search.set('page', String(page));
    if (query.q?.trim()) search.set('q', query.q.trim());
    if (query.size !== undefined) search.set('size', String(query.size));
    if (query.sort) search.set('sort', query.sort);
    if (query.filter) search.set('filter', query.filter);
    const suffix = search.toString();
    return suffix ? `${CATALOG_BASE}/sections/${section}?${suffix}` : `${CATALOG_BASE}/sections/${section}`;
  }

  // Badges for the dashboard Browse tiles. Every total here is a count query:
  // authors and series reuse the cached ones the web sidebar already asks for,
  // and the rest deliberately avoid the list methods behind the section
  // endpoints, which aggregate per-entity book counts a badge never reads.
  // A reader hiding audiobook-only books gets authors and series counted over
  // the books the lists show, since the sidebar's totals include the rest.
  private async buildBrowseCounts(user: RequestUser, visibility: CatalogVisibility): Promise<KoreaderCatalogBrowseCounts> {
    const [inProgress, authorSeriesCounts, libraries, collections, smartScopes] = await Promise.all([
      this.countBooks(user, { readStatus: 'reading' }, visibility),
      visibility.excludeAudioOnly ? this.countVisibleAuthorsAndSeries(user, visibility) : this.browseCountsService.getCounts(user),
      this.countVisibleLibraries(user, visibility),
      this.opdsBookService.countUserCollections(user.id),
      this.opdsBookService.countUserSmartScopes(user.id),
    ]);

    return {
      inProgress,
      libraries,
      authors: authorSeriesCounts.authors,
      series: authorSeriesCounts.series,
      collections,
      smartScopes,
    };
  }

  private async countVisibleAuthorsAndSeries(user: RequestUser, visibility: CatalogVisibility): Promise<{ authors: number; series: number }> {
    const narrowing = this.narrowing(visibility);
    const [authors, series] = await Promise.all([
      this.opdsBookService.countVisibleAuthors(user.id, user.isSuperuser, user.contentFilters, narrowing),
      this.opdsBookService.countVisibleSeries(user.id, user.isSuperuser, user.contentFilters, narrowing),
    ]);
    return { authors, series };
  }

  // Matches the libraries section, which drops a library holding only audiobook-only books.
  private async countVisibleLibraries(user: RequestUser, visibility: CatalogVisibility): Promise<number> {
    const libraryIds = await this.opdsBookService.getAccessibleLibraryIds(user.id, user.isSuperuser);
    if (!visibility.excludeAudioOnly) return libraryIds.length;
    return libraryIds.length - (await this.opdsBookService.findAudioOnlyLibraryIds(libraryIds)).length;
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
    visibility: CatalogVisibility,
  ): Promise<number> {
    return this.opdsBookService.countBooks(user.id, { ...filters, ...this.narrowing(visibility) }, user.isSuperuser, user.contentFilters);
  }

  // `total` keeps counting the page's own filters, read status included, while
  // `finished` and `reading` count the series regardless of the page's read
  // status filter. One query covers all three.
  private async computeSeriesSummary(user: RequestUser, filters: CatalogBookFilters): Promise<KoreaderCatalogSeriesSummary> {
    const { readStatus, ...scope } = filters;
    const summary = await this.opdsBookService.summarizeBooks(user.id, scope, 0, user.isSuperuser, user.contentFilters);
    const total =
      readStatus === 'reading'
        ? summary.reading
        : readStatus === 'finished'
          ? summary.finished
          : readStatus === 'unread'
            ? summary.total - summary.reading - summary.finished
            : summary.total;
    return { total, finished: summary.finished, reading: summary.reading };
  }

  private mapBookListItem(entry: OpdsBookEntry, progress: CatalogProgress | null, readStatus: string | null): KoreaderCatalogBookListItem {
    const formats = this.uniqueFormats(entry.files.map((file) => file.format));
    return {
      id: entry.id,
      title: entry.title,
      authors: entry.authors,
      seriesId: entry.seriesId ?? null,
      seriesName: entry.seriesName,
      seriesIndex: entry.seriesIndex,
      progressPercentage: progress?.percentage ?? null,
      lastReadAt: progress?.lastReadAt ?? null,
      readStatus,
      formats,
      hasCover: entry.hasCover,
      thumbnailUrl: entry.hasCover ? `${CATALOG_BASE}/books/${entry.id}/thumbnail` : null,
      detailUrl: `${CATALOG_BASE}/books/${entry.id}`,
      addedAt: entry.addedAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private mapBookDetail(
    detail: BookDetailDto,
    progress: CatalogProgress | null,
    relatedSections: KoreaderCatalogRelatedSection[] = [],
    filePattern = DEFAULT_KOREADER_DEVICE_PATTERN,
    sanitizeForCrossPlatform = true,
    variant?: ReadAloudDeliveryVariant,
    userId?: number,
  ): KoreaderCatalogBookDetail {
    const title = detail.title ?? (basename(detail.folderPath) || `Book ${detail.id}`);
    const files = detail.files
      .filter((file) => file.role === 'primary' || file.role === 'content')
      .map<KoreaderCatalogFile>((file) => {
        const extension = this.normalizeFormat(file.format);
        const downloadVariant =
          extension === 'epub' && variant !== 'original' && (file.mediaOverlay?.available === true || variant === 'audioless_epub')
            ? 'audioless_epub'
            : 'original';
        const hasSameFormatSibling = detail.files.some(
          (candidate) => candidate.id !== file.id && this.normalizeFormat(candidate.format) === extension,
        );
        const devicePath =
          resolveUploadPath(
            filePattern,
            buildPatternTokens({
              metadata: {
                title,
                subtitle: detail.subtitle,
                publisher: detail.publisher,
                language: detail.language,
                isbn13: detail.isbn13,
                isbn10: detail.isbn10,
                publishedYear: detail.publishedYear,
                seriesName: detail.seriesName,
                seriesIndex: detail.seriesIndex,
              },
              authors: detail.authors.map((author) => author.name),
              originalStem: basename(file.filename ?? title, `.${extension}`),
              format: extension,
              libraryName: detail.libraryName,
            }),
            extension,
            { sanitizeForCrossPlatform },
          ) ??
          file.filename ??
          `${title}.${extension}`;
        return {
          id: file.id,
          format: extension,
          role: file.role,
          downloadVariant,
          sizeBytes: downloadVariant === 'audioless_epub' ? null : file.sizeBytes,
          sourceSizeBytes: file.sizeBytes,
          durationSeconds: file.durationSeconds,
          fileHash: downloadVariant === 'original' ? file.fileHash : null,
          requestedVariant: variant,
          sourceMediaOverlayAvailable: file.mediaOverlay?.available === true,
          narrationPlaybackAvailable: downloadVariant === 'original' && file.mediaOverlay?.available === true,
          contentVersion: file.contentVersion,
          selection:
            variant && userId ? this.deliverySelection?.descriptor(userId, 'koreader', file.id, variant, file.contentVersion ?? '') : undefined,
          downloadUrl: this.downloadUrl(file.id, variant, userId, file.contentVersion ?? ''),
          devicePath: this.variantDevicePath(devicePath, downloadVariant, hasSameFormatSibling, variant ? file.id : undefined),
        };
      });

    return {
      id: detail.id,
      title,
      authors: detail.authors.map((author) => author.name),
      seriesId: detail.seriesId,
      seriesName: detail.seriesName,
      seriesIndex: detail.seriesIndex,
      progressPercentage: progress?.percentage ?? null,
      lastReadAt: progress?.lastReadAt ?? null,
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
      publishedDate: detail.publishedDate,
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
      progress: progress ? this.publicProgress(progress) : null,
      files,
      relatedSections,
    };
  }

  private async enrichDeliveryFiles(userId: number, files: (KoreaderCatalogFile | KoreaderCatalogManifestFile)[]) {
    if (!this.deliverySelection) return;
    const metadata = await this.deliverySelection.metadata(
      userId,
      'koreader',
      files.flatMap((file) => (file.selection ? [file.selection] : [])),
    );
    for (const file of files) {
      const captured = file.selection && metadata.get(file.selection);
      if (!captured) continue;
      file.delivery = captured;
      file.sizeBytes = captured.sizeBytes;
      file.fileHash = captured.fileHash;
      file.narrationPlaybackAvailable =
        captured.actualVariant === 'original' && captured.outcome !== 'verified_plain' && file.sourceMediaOverlayAvailable === true;
    }
  }

  private downloadUrl(fileId: number, variant?: ReadAloudDeliveryVariant, userId?: number, contentVersion = ''): string {
    if (!variant || !userId || !this.deliverySelection) return `${CATALOG_BASE}/files/${fileId}/download`;
    const selection = this.deliverySelection.descriptor(userId, 'koreader', fileId, variant, contentVersion);
    return `${CATALOG_BASE}/files/${fileId}/download?variant=${variant}&selection=${encodeURIComponent(selection)}`;
  }

  private variantDevicePath(path: string, variant: KoreaderCatalogFile['downloadVariant'], hasSameFormatSibling: boolean, fileId?: number): string {
    if (fileId) return path.replace(/\.([^./]+)$/, ` - bo-${fileId}-${variant}.$1`);
    if (variant !== 'audioless_epub' || !hasSameFormatSibling) return path;
    return /\.epub$/i.test(path) ? path.replace(/\.epub$/i, ' - Read Along.epub') : `${path} - Read Along.epub`;
  }

  private async buildRelatedSections(
    user: RequestUser,
    bookId: number,
    visibility: CatalogVisibility,
  ): Promise<{ sections: KoreaderCatalogRelatedSection[]; seriesMembers: KoreaderCatalogSeriesMember[] }> {
    const [seriesLookup, authorLookup, similarLookup] = await Promise.all([
      this.safeRelatedLookup(() => this.recommendationService.getSeriesBooks(bookId, user)),
      this.safeRelatedLookup(() => this.recommendationService.getAuthorBooks(bookId, user)),
      this.safeRelatedLookup(() => this.recommendationService.getRecommendations(bookId, user)),
    ]);
    const audioOnly = visibility.excludeAudioOnly
      ? await this.opdsBookService.findAudioOnlyBookIds([...seriesLookup, ...authorLookup, ...similarLookup].map((book) => book.id))
      : new Set<number>();
    // The book on screen keeps its own place in its series strip even when it is audiobook-only.
    const shown = (book: { id: number }) => book.id === bookId || !audioOnly.has(book.id);
    const seriesBooks = seriesLookup.filter(shown);
    const authorBooks = authorLookup.filter(shown);
    const similarBooks = similarLookup.filter(shown);

    const sections: KoreaderCatalogRelatedSection[] = [];
    const seriesMembers: KoreaderCatalogSeriesMember[] = seriesBooks.map((book) => ({
      id: book.id,
      title: book.title,
      seriesIndex: book.seriesIndex ?? null,
      readStatus: book.readStatus?.status ?? null,
    }));
    const excludedFromSimilar = new Set<number>([bookId]);
    const series = seriesBooks.filter((book) => book.id !== bookId).slice(0, DETAIL_RELATED_LIMIT);
    for (const book of series) excludedFromSimilar.add(book.id);
    if (series.length > 0) {
      sections.push({
        id: 'series',
        title: 'More in series',
        books: series.map((book) => this.mapRelatedBook(book)),
      });
    }

    const authors = authorBooks.filter((book) => book.id !== bookId).slice(0, DETAIL_RELATED_LIMIT);
    for (const book of authors) excludedFromSimilar.add(book.id);
    if (authors.length > 0) {
      sections.push({
        id: 'author',
        title: 'Also by this author',
        books: authors.map((book) => this.mapRelatedBook(book)),
      });
    }

    const similar = similarBooks.filter((book) => !excludedFromSimilar.has(book.id)).slice(0, DETAIL_RELATED_LIMIT);
    if (similar.length > 0) {
      sections.push({
        id: 'similar',
        title: 'Similar books',
        books: similar.map((book) => this.mapRelatedBook(book)),
      });
    }

    return { sections, seriesMembers };
  }

  private async safeRelatedLookup<T>(lookup: () => Promise<T[]>): Promise<T[]> {
    try {
      return await lookup();
    } catch {
      return [];
    }
  }

  private mapRelatedBook(book: {
    id: number;
    title: string | null;
    authors: string[];
    seriesIndex?: string | null;
    hasCover: boolean;
    updatedAt: string | null;
    isAudiobook?: boolean;
    isComic?: boolean;
  }): KoreaderCatalogRelatedBook {
    return {
      id: book.id,
      title: book.title,
      authors: book.authors,
      seriesIndex: book.seriesIndex ?? null,
      hasCover: book.hasCover,
      thumbnailUrl: book.hasCover ? `${CATALOG_BASE}/books/${book.id}/thumbnail` : null,
      detailUrl: `${CATALOG_BASE}/books/${book.id}`,
      updatedAt: book.updatedAt,
      isAudiobook: book.isAudiobook,
      isComic: book.isComic,
    };
  }

  private async findBestProgress(userId: number, bookId: number): Promise<CatalogProgress | null> {
    const rows = await this.bookReadService.findProgressByBook(userId, bookId);
    let best: ProgressCandidate | null = null;
    let lastReadAt: Date | null = null;
    for (const row of rows) {
      if (row.percentage == null || row.updatedAt == null) continue;
      const candidate = row as ProgressCandidate;
      if (!best || candidate.updatedAt > best.updatedAt) {
        best = candidate;
      }
      lastReadAt = latestDate(lastReadAt, candidate.lastReadAt ?? candidate.updatedAt);
    }

    return best ? { ...this.mapProgress(best), lastReadAt: (lastReadAt ?? best.updatedAt).toISOString() } : null;
  }

  private async findBestProgressMap(userId: number, bookIds: number[]): Promise<Map<number, CatalogProgress>> {
    const map = new Map<number, CatalogProgress>();
    if (bookIds.length === 0) return map;

    const rows = await this.bookReadService.findProgressByBooks(userId, bookIds);
    const best = new Map<number, BatchProgressCandidate>();
    const lastRead = new Map<number, Date>();
    for (const row of rows) {
      if (row.percentage == null || row.updatedAt == null) continue;
      const candidate = row as BatchProgressCandidate;
      const current = best.get(row.bookId);
      if (!current || candidate.updatedAt > current.updatedAt) {
        best.set(row.bookId, candidate);
      }
      lastRead.set(row.bookId, latestDate(lastRead.get(row.bookId) ?? null, candidate.lastReadAt ?? candidate.updatedAt) ?? candidate.updatedAt);
    }

    for (const [bookId, candidate] of best) {
      map.set(bookId, {
        fileId: candidate.fileId,
        percentage: candidate.percentage,
        koreaderProgress: candidate.koreaderProgress ?? null,
        updatedAt: candidate.updatedAt.toISOString(),
        lastReadAt: (lastRead.get(bookId) ?? candidate.updatedAt).toISOString(),
      });
    }
    return map;
  }

  private publicProgress({ fileId, percentage, koreaderProgress, updatedAt }: CatalogProgress): KoreaderCatalogProgress {
    return { fileId, percentage, koreaderProgress, updatedAt };
  }

  private mapProgress(row: ProgressCandidate): KoreaderCatalogProgress {
    return {
      fileId: row.fileId,
      percentage: row.percentage ?? 0,
      koreaderProgress: row.koreaderProgress ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async resolveVisibility(user: RequestUser): Promise<CatalogVisibility> {
    return { excludeAudioOnly: await this.koreaderService.hidesAudioOnlyBooks(user.id) };
  }

  // Spread into a query's filters: names the narrowing only when there is one, so an unnarrowed
  // query reads exactly as it did before the setting existed.
  private narrowing(visibility: CatalogVisibility): CatalogVisibilityOptions {
    return visibility.excludeAudioOnly ? { excludeAudioOnly: true } : {};
  }

  private buildBookFilters(
    query: KoreaderCatalogBooksQueryDto | KoreaderCatalogManifestQueryDto,
    visibility: CatalogVisibility,
  ): {
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
    excludeAudioOnly?: boolean;
  } {
    return {
      ...this.narrowing(visibility),
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
        return descending ? 'last_read' : 'last_read_asc';
      case 'series':
        return descending ? 'series_desc' : 'series_asc';
      case 'recently_added':
      default:
        return descending ? 'recent' : 'recent_asc';
    }
  }

  // offset is set only when the request paged by offset; its links do too.
  private paginate<T>(
    items: T[],
    total: number,
    page: number,
    size: number,
    query: KoreaderCatalogBooksQueryDto,
    seriesSummary: KoreaderCatalogSeriesSummary | null = null,
    offset?: number,
  ): KoreaderCatalogPage<T> {
    if (offset !== undefined) {
      const hasNext = offset + size < total;
      const hasPrevious = offset > 0;
      return {
        items,
        total,
        page,
        size,
        offset,
        hasNext,
        hasPrevious,
        nextUrl: hasNext ? this.booksHref({ ...query, page: undefined, offset: offset + size, size }) : null,
        previousUrl: hasPrevious ? this.booksHref({ ...query, page: undefined, offset: Math.max(0, offset - size), size }) : null,
        seriesSummary,
      };
    }
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
      'offset',
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

  private assertPaginationWindow(offset: number): void {
    if (!isOffsetWithinLimit(offset)) {
      throw new BadRequestException(`pagination window is too deep; (page - 1) * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  private normalizeFormat(format: string | null | undefined): string {
    return (format ?? 'bin').toLowerCase();
  }

  private uniqueFormats(formats: string[]): string[] {
    return [...new Set(formats.map((format) => this.normalizeFormat(format)).filter(Boolean))];
  }
}
