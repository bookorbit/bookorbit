import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { BookCard, DashboardScrollerBatchResponse, DashboardScrollerResponse } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookReadService } from '../book/book-read.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { SmartScopeService } from '../smart-scope/smart-scope.service';
import { LibraryService } from '../library/library.service';
import { DashboardRepository } from './dashboard.repository';
import { resolveDashboardLibraryIds } from './dashboard-library-scope';
import { DASHBOARD_SCROLLER_MAX_LIMIT, type DashboardScrollerBatchDto, type DashboardScrollerBatchItemDto } from './dto/dashboard-scroller-batch.dto';
import { ScrollerType } from './dto/scroller-type.enum';

const SCROLLER_QUERY_CONCURRENCY = 3;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dashboardRepo: DashboardRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly smartScopeService: SmartScopeService,
    private readonly coverStore: BookCoverStore,
  ) {}

  private async loadCardsByIds(bookIds: number[], userId: number): Promise<BookCard[]> {
    if (bookIds.length === 0) return [];
    const { rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows } = await this.bookReadService.findCardsByBookIds(
      bookIds,
      userId,
    );
    const cards = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows);
    await this.coverStore.enrichCardVersions(cards);
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    return bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null);
  }

  async getScrollers(dto: DashboardScrollerBatchDto, user: RequestUser): Promise<DashboardScrollerBatchResponse> {
    const startedAt = Date.now();
    const requestIds = new Set(dto.items.map((item) => item.id));
    if (requestIds.size !== dto.items.length) throw new BadRequestException('Scroller batch item IDs must be unique');

    this.logger.debug(
      `[dashboard.scroller_batch] [start] userId=${user.id} shelfCount=${dto.items.length} concurrency=${SCROLLER_QUERY_CONCURRENCY} - scroller batch started`,
    );

    const accessibleLibraryIds = resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
    const selections = await mapWithConcurrency(dto.items, SCROLLER_QUERY_CONCURRENCY, async (item) => {
      const selectionStartedAt = Date.now();
      try {
        const bookIds = await this.findBatchScrollerBookIds(item, user, accessibleLibraryIds);
        return { item, bookIds, failed: false };
      } catch (error) {
        const errorClass = error instanceof Error ? error.constructor.name : typeof error;
        const message = sanitizeLogValue(error instanceof Error ? error.message : error);
        this.logger.warn(
          `[dashboard.scroller_query] [fail] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} durationMs=${Date.now() - selectionStartedAt} errorClass=${errorClass} error="${message}" - scroller selection failed`,
        );
        return { item, bookIds: [] as number[], failed: true };
      }
    });

    const uniqueBookIds = [...new Set(selections.flatMap((selection) => selection.bookIds))];
    const hydrationStartedAt = Date.now();
    this.logger.debug(`[dashboard.card_hydration] [start] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} - shared card hydration started`);
    let cards: BookCard[];
    try {
      cards = await this.loadCardsByIds(uniqueBookIds, user.id);
      this.logger.debug(
        `[dashboard.card_hydration] [end] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} resultCount=${cards.length} durationMs=${Date.now() - hydrationStartedAt} - shared card hydration completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      const message = sanitizeLogValue(error instanceof Error ? error.message : error);
      this.logger.warn(
        `[dashboard.card_hydration] [fail] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} durationMs=${Date.now() - hydrationStartedAt} errorClass=${errorClass} error="${message}" - shared card hydration failed`,
      );
      throw error;
    }
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const items = selections.map(({ item, bookIds, failed }) => ({
      id: item.id,
      books: bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null),
      failed,
    }));

    this.logger.debug(
      `[dashboard.scroller_batch] [end] userId=${user.id} shelfCount=${items.length} failedCount=${items.filter((item) => item.failed).length} uniqueBookCount=${uniqueBookIds.length} durationMs=${Date.now() - startedAt} - scroller batch completed`,
    );
    return { items };
  }

  private async findBatchScrollerBookIds(item: DashboardScrollerBatchItemDto, user: RequestUser, accessibleLibraryIds: number[]): Promise<number[]> {
    const startedAt = Date.now();
    this.logger.debug(
      `[dashboard.scroller_query] [start] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} limit=${item.limit} - scroller selection started`,
    );

    let bookIds: number[];
    if (item.type === ScrollerType.SMART_SCOPE) {
      const smartScopeId = this.assertSmartScopeId(item.smartScopeId);
      bookIds = await this.smartScopeService.executeSmartScopeBookIds(smartScopeId, user, item.limit, accessibleLibraryIds);
    } else {
      bookIds = await this.findScrollerBookIdsForLibraries(item.type, user, item.limit, accessibleLibraryIds);
    }

    this.logger.debug(
      `[dashboard.scroller_query] [end] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} resultCount=${bookIds.length} durationMs=${Date.now() - startedAt} - scroller selection completed`,
    );
    return bookIds;
  }

  async getScroller(type: ScrollerType, user: RequestUser, limit: number, smartScopeId?: number): Promise<DashboardScrollerResponse> {
    const clampedLimit = Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT);

    if (type === ScrollerType.SMART_SCOPE) {
      const resolvedSmartScopeId = this.assertSmartScopeId(smartScopeId);
      const scope = await this.smartScopeService.findOne(resolvedSmartScopeId, user);
      if (scope.mediaType !== 'books') return { books: [], total: 0 };
      const accessibleLibraryIds = resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
      const result = await this.smartScopeService.executeSmartScope(resolvedSmartScopeId, user, 0, clampedLimit, undefined, accessibleLibraryIds);
      return { books: result.items, total: result.total };
    }

    // Resolved once and handed to both halves. The selection and the count have to agree about
    // which libraries are in play, and asking twice invites them to disagree.
    const accessibleLibraryIds = resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
    const bookIds = await this.findScrollerBookIdsForLibraries(type, user, clampedLimit, accessibleLibraryIds);
    const [books, total] = await Promise.all([this.loadCardsByIds(bookIds, user.id), this.countScroller(type, user, accessibleLibraryIds)]);

    return { books, total };
  }

  /**
   * How many books the shelf could have drawn from, or null where the answer is not worth its
   * query. See `DashboardScrollerResponse.total`: `up-next-in-series` would have to materialise its
   * recursive CTE in full, and `random` would anti-join the whole library to size a pool it only
   * ever samples. Neither shelf is asked, and neither guesses.
   */
  private async countScroller(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, accessibleLibraryIds: number[]): Promise<number | null> {
    if (accessibleLibraryIds.length === 0) return 0;

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    switch (type) {
      // Not the whole library, which is what this shelf could technically return. See
      // `countBooksAddedThisMonth`: a recency shelf is only interesting for how much is new.
      case ScrollerType.RECENTLY_ADDED:
        return this.dashboardRepo.countBooksAddedThisMonth(accessibleLibraryIds, contentFilters);
      case ScrollerType.CONTINUE_READING:
        return this.dashboardRepo.countContinueReadingBooks(accessibleLibraryIds, user.id, contentFilters);
      case ScrollerType.CONTINUE_LISTENING:
        return this.dashboardRepo.countContinueListeningBooks(accessibleLibraryIds, user.id, contentFilters);
      case ScrollerType.WANT_TO_READ:
        return this.dashboardRepo.countWantToReadBooks(accessibleLibraryIds, user.id, contentFilters);
      case ScrollerType.UP_NEXT_IN_SERIES:
      case ScrollerType.RANDOM:
        return null;
    }
  }

  // Book-id selection without web card assembly lets other clients shape the
  // same rows. Smart scopes stay separate because they have their own access path.
  async getScrollerBookIds(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, limit: number): Promise<number[]> {
    return this.findScrollerBookIds(type, user, Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT));
  }

  async getSmartScopeBookIds(smartScopeId: number | undefined, user: RequestUser, limit: number): Promise<number[]> {
    const resolvedSmartScopeId = this.assertSmartScopeId(smartScopeId);
    const scope = await this.smartScopeService.findOne(resolvedSmartScopeId, user);
    if (scope.mediaType !== 'books') return [];
    const accessibleLibraryIds = resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
    const result = await this.smartScopeService.executeSmartScope(
      resolvedSmartScopeId,
      user,
      0,
      Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT),
      undefined,
      accessibleLibraryIds,
    );
    return result.items.map((item) => item.id);
  }

  private assertSmartScopeId(smartScopeId?: number): number {
    if (!smartScopeId || smartScopeId <= 0) {
      throw new BadRequestException('smartScopeId is required and must be a positive integer when scroller type is smartScope');
    }
    return smartScopeId;
  }

  private async findScrollerBookIds(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, clampedLimit: number): Promise<number[]> {
    const accessibleLibraryIds = resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
    return this.findScrollerBookIdsForLibraries(type, user, clampedLimit, accessibleLibraryIds);
  }

  private async findScrollerBookIdsForLibraries(
    type: Exclude<ScrollerType, 'smart-scope'>,
    user: RequestUser,
    clampedLimit: number,
    accessibleLibraryIds: number[],
  ): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    switch (type) {
      case ScrollerType.RECENTLY_ADDED:
        return this.dashboardRepo.findRecentlyAddedBookIds(accessibleLibraryIds, clampedLimit, contentFilters);
      case ScrollerType.CONTINUE_READING:
        return this.dashboardRepo.findContinueReadingBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.CONTINUE_LISTENING:
        return this.dashboardRepo.findContinueListeningBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.WANT_TO_READ:
        return this.dashboardRepo.findWantToReadBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.UP_NEXT_IN_SERIES:
        return this.dashboardRepo.findUpNextInSeriesBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.RANDOM:
        return this.dashboardRepo.findRandomBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
    }
  }
}
