import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { ScrollerType } from './dto/scroller-type.enum';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

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

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const dashboardRepo = {
    findRecentlyAddedBookIds: vi.fn(),
    findContinueReadingBookIds: vi.fn(),
    findUpNextInSeriesBookIds: vi.fn(),
    findRandomBookIds: vi.fn(),
  };
  const bookReadService = {
    findCardsByBookIds: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
  };
  const smartScopeService = {
    executeSmartScope: vi.fn(),
  };

  const service = new DashboardService(dashboardRepo as never, bookReadService as never, libraryService as never, smartScopeService as never);
  return { service, dashboardRepo, bookReadService, libraryService, smartScopeService };
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
    tagRows: [],
    narratorRows: [],
    progressRows: [],
    statusRows: [],
    total: idsInRowOrder.length,
  };
}

describe('DashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects smartScope scroller calls when smartScopeId is missing or invalid', async () => {
    const { service, smartScopeService } = makeService();

    await expect(service.getScroller(ScrollerType.SMART_SCOPE, makeUser(), 20, 0)).rejects.toThrow(BadRequestException);
    await expect(service.getScroller(ScrollerType.SMART_SCOPE, makeUser(), 20, -2)).rejects.toThrow(BadRequestException);

    expect(smartScopeService.executeSmartScope).not.toHaveBeenCalled();
  });

  it('executes smartScope scroller with max limit clamp and returns smartScope items', async () => {
    const { service, smartScopeService } = makeService();
    const user = makeUser({ id: 7 });
    const items = [{ id: 11 }, { id: 12 }];
    smartScopeService.executeSmartScope.mockResolvedValue({ items, total: 2, page: 0, size: 50 });

    const result = await service.getScroller(ScrollerType.SMART_SCOPE, user, 999, 88);

    expect(smartScopeService.executeSmartScope).toHaveBeenCalledWith(88, user, 0, 50);
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
    bookReadService.findCardsByBookIds.mockResolvedValue({
      ...makeFindCardsResult([3, 9]),
      statusRows: [
        {
          bookId: 9,
          status: 'reading',
          source: 'manual',
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, user, 0);

    expect(dashboardRepo.findRecentlyAddedBookIds).toHaveBeenCalledWith([100, 200], 1, EMPTY_CONTENT_FILTER_RULES);
    expect(bookReadService.findCardsByBookIds).toHaveBeenCalledWith([9, 3], 5);
    expect(result.map((card) => card.id)).toEqual([9, 3]);
    expect(result[0]?.readStatus?.status).toBe('reading');
  });

  it('routes continue reading requests to repository with clamped max limit', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 9 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([301]);
    dashboardRepo.findContinueReadingBookIds.mockResolvedValue([4]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([4]));

    const result = await service.getScroller(ScrollerType.CONTINUE_READING, user, 500);

    expect(dashboardRepo.findContinueReadingBookIds).toHaveBeenCalledWith([301], 9, 50, EMPTY_CONTENT_FILTER_RULES);
    expect(result.map((card) => card.id)).toEqual([4]);
  });

  it('routes up-next-in-series requests to repository and preserves response order', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 11 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([707]);
    dashboardRepo.findUpNextInSeriesBookIds.mockResolvedValue([19, 8]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([8, 19]));

    const result = await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 25);

    expect(dashboardRepo.findUpNextInSeriesBookIds).toHaveBeenCalledWith([707], 11, 25, EMPTY_CONTENT_FILTER_RULES);
    expect(result.map((card) => card.id)).toEqual([19, 8]);
  });

  it('passes undefined content filters for up-next-in-series when user is superuser', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const superuser = makeUser({ id: 17, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
    dashboardRepo.findUpNextInSeriesBookIds.mockResolvedValue([55]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([55]));

    await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, superuser, 20);

    expect(dashboardRepo.findUpNextInSeriesBookIds).toHaveBeenCalledWith([1], 17, 20, undefined);
  });

  it('clamps up-next-in-series limit to minimum of 1', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 18 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([91]);
    dashboardRepo.findUpNextInSeriesBookIds.mockResolvedValue([3]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([3]));

    await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 0);

    expect(dashboardRepo.findUpNextInSeriesBookIds).toHaveBeenCalledWith([91], 18, 1, EMPTY_CONTENT_FILTER_RULES);
  });

  it('routes random requests to repository and skips card fetch when no ids are returned', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    libraryService.findAccessibleLibraryIds.mockResolvedValue([901]);
    dashboardRepo.findRandomBookIds.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.RANDOM, makeUser({ id: 3 }), 20);

    expect(dashboardRepo.findRandomBookIds).toHaveBeenCalledWith([901], 3, 20, EMPTY_CONTENT_FILTER_RULES);
    expect(result).toEqual([]);
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
  });
});
