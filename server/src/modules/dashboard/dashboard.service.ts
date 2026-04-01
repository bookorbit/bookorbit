import { BadRequestException, Injectable } from '@nestjs/common';

import type { BookCard } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { LensService } from '../lens/lens.service';
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
    private readonly lensService: LensService,
  ) {}

  private async loadCardsByIds(bookIds: number[], userId: number): Promise<BookCard[]> {
    if (bookIds.length === 0) return [];
    const { rows, authorRows, fileRows, genreRows, progressRows } = await this.bookReadService.findCardsByBookIds(bookIds, userId);
    const cards = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows);
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    return bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null);
  }

  async getScroller(type: ScrollerType, user: RequestUser, limit: number, lensId?: number): Promise<BookCard[]> {
    const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    if (type === ScrollerType.LENS) {
      if (!lensId || lensId <= 0) {
        throw new BadRequestException('lensId is required and must be a positive integer when scroller type is lens');
      }
      const result = await this.lensService.executeLens(lensId, user, 0, clampedLimit);
      return result.items;
    }

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (accessibleLibraryIds.length === 0) return [];

    let bookIds: number[];
    switch (type) {
      case ScrollerType.RECENTLY_ADDED:
        bookIds = await this.dashboardRepo.findRecentlyAddedBookIds(accessibleLibraryIds, clampedLimit);
        break;
      case ScrollerType.CONTINUE_READING:
        bookIds = await this.dashboardRepo.findContinueReadingBookIds(accessibleLibraryIds, user.id, clampedLimit);
        break;
      case ScrollerType.RANDOM:
        bookIds = await this.dashboardRepo.findRandomBookIds(accessibleLibraryIds, user.id, clampedLimit);
        break;
    }

    return this.loadCardsByIds(bookIds, user.id);
  }
}
