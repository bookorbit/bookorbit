import { Injectable } from '@nestjs/common';

import type { BookCard } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { LensService } from '../lens/lens.service';
import { LibraryService } from '../library/library.service';
import { DashboardRepository } from './dashboard.repository';
import { ScrollerType } from './dto/scroller-type.enum';

const MAX_LIMIT = 50;

@Injectable()
export class DashboardService {
  constructor(
    private readonly dashboardRepo: DashboardRepository,
    private readonly libraryService: LibraryService,
    private readonly lensService: LensService,
  ) {}

  async getScroller(type: ScrollerType, user: RequestUser, limit: number, lensId?: number): Promise<BookCard[]> {
    const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    if (type === ScrollerType.LENS) {
      if (!lensId) return [];
      const result = await this.lensService.executeLens(lensId, user, 0, clampedLimit);
      return result.items;
    }

    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);
    if (accessibleLibraryIds.length === 0) return [];

    switch (type) {
      case ScrollerType.RECENTLY_ADDED:
        return this.dashboardRepo.findRecentlyAdded(accessibleLibraryIds, user.id, clampedLimit);
      case ScrollerType.CONTINUE_READING:
        return this.dashboardRepo.findContinueReading(accessibleLibraryIds, user.id, clampedLimit);
      case ScrollerType.RANDOM:
        return this.dashboardRepo.findRandom(accessibleLibraryIds, user.id, clampedLimit);
      default:
        return [];
    }
  }
}
