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
      if (!smartScopeId || smartScopeId <= 0) {
        throw new BadRequestException('smartScopeId is required and must be a positive integer when scroller type is smartScope');
      }
      const result = await this.smartScopeService.executeSmartScope(smartScopeId, user, 0, clampedLimit);
      return result.items;
    }

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (accessibleLibraryIds.length === 0) return [];

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    let bookIds: number[];
    switch (type) {
      case ScrollerType.RECENTLY_ADDED:
        bookIds = await this.dashboardRepo.findRecentlyAddedBookIds(accessibleLibraryIds, clampedLimit, contentFilters);
        break;
      case ScrollerType.CONTINUE_READING:
        bookIds = await this.dashboardRepo.findContinueReadingBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
        break;
      case ScrollerType.UP_NEXT_IN_SERIES:
        bookIds = await this.dashboardRepo.findUpNextInSeriesBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
        break;
      case ScrollerType.RANDOM:
        bookIds = await this.dashboardRepo.findRandomBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
        break;
    }

    return this.loadCardsByIds(bookIds, user.id);
  }
}
