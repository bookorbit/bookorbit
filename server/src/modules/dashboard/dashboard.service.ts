import { BadRequestException, Injectable } from '@nestjs/common';

import type { BookCard } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { SmartScopeService } from '../smart-scope/smart-scope.service';
import { LibraryService } from '../library/library.service';
import { DashboardRepository } from './dashboard.repository';
import { ScrollerType } from './dto/scroller-type.enum';

const MAX_LIMIT = 50;

@Injectable()
export class DashboardService {
  constructor(
    private readonly dashboardRepo: DashboardRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly smartScopeService: SmartScopeService,
  ) {}

  private async loadCardsByIds(bookIds: number[], userId: number): Promise<BookCard[]> {
    if (bookIds.length === 0) return [];
    const { rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows } = await this.bookReadService.findCardsByBookIds(
      bookIds,
      userId,
    );
    const cards = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows);
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    return bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null);
  }

  async getScroller(type: ScrollerType, user: RequestUser, limit: number, smartScopeId?: number): Promise<BookCard[]> {
    const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    if (type === ScrollerType.SMART_SCOPE) {
      const result = await this.smartScopeService.executeSmartScope(this.assertSmartScopeId(smartScopeId), user, 0, clampedLimit);
      return result.items;
    }

    return this.loadCardsByIds(await this.findScrollerBookIds(type, user, clampedLimit), user.id);
  }

  // Book-id selection without the web card assembly, so other modules can shape
  // the same rows into their own response type. Smart scopes are excluded: they
  // resolve through SmartScopeService, which returns assembled cards directly.
  async getScrollerBookIds(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, limit: number): Promise<number[]> {
    return this.findScrollerBookIds(type, user, Math.min(Math.max(1, limit), MAX_LIMIT));
  }

  async getSmartScopeBookIds(smartScopeId: number | undefined, user: RequestUser, limit: number): Promise<number[]> {
    const result = await this.smartScopeService.executeSmartScope(
      this.assertSmartScopeId(smartScopeId),
      user,
      0,
      Math.min(Math.max(1, limit), MAX_LIMIT),
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
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
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
