import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { ScrollerType } from './dto/scroller-type.enum';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 42,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

function makeService() {
  const dashboardRepo = {
    findRecentlyAddedBookIds: vi.fn(),
    findContinueReadingBookIds: vi.fn(),
    findRandomBookIds: vi.fn(),
  };
  const bookReadService = {
    findCardsByBookIds: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
  };
  const lensService = {
    executeLens: vi.fn(),
  };

  const service = new DashboardService(dashboardRepo as never, bookReadService as never, libraryService as never, lensService as never);
  return { service, dashboardRepo, bookReadService, libraryService, lensService };
}

function makeFindCardsResult(idsInRowOrder: number[]) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    rows: idsInRowOrder.map((id) => ({
      id,
      status: 'present',
      primaryFileId: id * 10,
      folderPath: `/books/${id}`,
      addedAt: now,
      title: `Book ${id}`,
      seriesName: null,
      seriesIndex: null,
      publishedYear: null,
      language: null,
      rating: null,
    })),
    authorRows: [],
    fileRows: idsInRowOrder.map((id) => ({ bookId: id, id: id * 10, format: 'epub', role: 'primary' })),
    genreRows: [],
    progressRows: [],
    statusRows: [],
    total: idsInRowOrder.length,
  };
}

describe('DashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects lens scroller calls when lensId is missing or invalid', async () => {
    const { service, lensService } = makeService();

    await expect(service.getScroller(ScrollerType.LENS, makeUser(), 20, 0)).rejects.toThrow(BadRequestException);
    await expect(service.getScroller(ScrollerType.LENS, makeUser(), 20, -2)).rejects.toThrow(BadRequestException);

    expect(lensService.executeLens).not.toHaveBeenCalled();
  });

  it('executes lens scroller with max limit clamp and returns lens items', async () => {
    const { service, lensService } = makeService();
    const user = makeUser({ id: 7 });
    const items = [{ id: 11 }, { id: 12 }];
    lensService.executeLens.mockResolvedValue({ items, total: 2, page: 0, size: 50 });

    const result = await service.getScroller(ScrollerType.LENS, user, 999, 88);

    expect(lensService.executeLens).toHaveBeenCalledWith(88, user, 0, 50);
    expect(result).toEqual(items);
  });

  it('returns empty list when user has no accessible libraries', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    libraryService.findAccessibleLibraryIds.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, makeUser(), 20);

    expect(result).toEqual([]);
    expect(dashboardRepo.findRecentlyAddedBookIds).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
  });

  it('loads recently added cards with min limit clamp and preserves repository id order', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([100, 200]);
    dashboardRepo.findRecentlyAddedBookIds.mockResolvedValue([9, 3]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([3, 9]));

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, user, 0);

    expect(dashboardRepo.findRecentlyAddedBookIds).toHaveBeenCalledWith([100, 200], 1);
    expect(bookReadService.findCardsByBookIds).toHaveBeenCalledWith([9, 3], 5);
    expect(result.map((card) => card.id)).toEqual([9, 3]);
  });

  it('routes continue reading requests to repository with clamped max limit', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 9 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([301]);
    dashboardRepo.findContinueReadingBookIds.mockResolvedValue([4]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([4]));

    const result = await service.getScroller(ScrollerType.CONTINUE_READING, user, 500);

    expect(dashboardRepo.findContinueReadingBookIds).toHaveBeenCalledWith([301], 9, 50);
    expect(result.map((card) => card.id)).toEqual([4]);
  });

  it('routes random requests to repository and skips card fetch when no ids are returned', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    libraryService.findAccessibleLibraryIds.mockResolvedValue([901]);
    dashboardRepo.findRandomBookIds.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.RANDOM, makeUser({ id: 3 }), 20);

    expect(dashboardRepo.findRandomBookIds).toHaveBeenCalledWith([901], 3, 20);
    expect(result).toEqual([]);
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
  });
});
