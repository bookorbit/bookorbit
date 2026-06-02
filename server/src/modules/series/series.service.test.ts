import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import { SeriesService } from './series.service';

function reqUser(id = 7, superuser = false) {
  return { id, isSuperuser: superuser, permissions: [], contentFilters: undefined } as any;
}

describe('SeriesService', () => {
  const seriesRepo = {
    findPage: vi.fn(),
    findDetail: vi.fn(),
    findBookIds: vi.fn(),
  };

  const bookReadService = {
    findCardsByBookIds: vi.fn(),
  };

  const libraryService = {
    findAll: vi.fn(),
  };

  let service: SeriesService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new SeriesService(seriesRepo as any, bookReadService as any, libraryService as any);
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  });

  describe('findAll', () => {
    it('returns empty page when user has no library access', async () => {
      libraryService.findAll.mockResolvedValue([]);
      const result = await service.findAll(reqUser(), { page: 0, size: 50 });
      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
      expect(seriesRepo.findPage).not.toHaveBeenCalled();
    });

    it('delegates to repository with correct params', async () => {
      seriesRepo.findPage.mockResolvedValue({
        items: [
          {
            id: 42,
            name: 'Harry Potter',
            bookCount: 7,
            readCount: 3,
            authors: ['J.K. Rowling'],
            coverBookIds: [1, 2, 3, 4],
            lastAddedAt: '2024-01-01 00:00:00',
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      });

      const result = await service.findAll(reqUser(), { sort: 'bookCount', order: 'desc' });

      expect(seriesRepo.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'bookCount',
          order: 'desc',
          libraryIds: [1, 2],
          userId: 7,
          contentFilters: undefined,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.name).toBe('Harry Potter');
      expect(result.items[0]!.lastAddedAt).toBe('2024-01-01 00:00:00');
    });

    it('scopes to specific library when libraryId provided', async () => {
      seriesRepo.findPage.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });
      await service.findAll(reqUser(), { libraryId: 2 });
      expect(seriesRepo.findPage).toHaveBeenCalledWith(expect.objectContaining({ libraryIds: [2], contentFilters: undefined }));
    });

    it('returns empty when scoped library is inaccessible', async () => {
      const result = await service.findAll(reqUser(), { libraryId: 99 });
      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
    });

    it('rejects deep pagination', async () => {
      await expect(service.findAll(reqUser(), { page: 10000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('converts null lastAddedAt to null', async () => {
      seriesRepo.findPage.mockResolvedValue({
        items: [{ id: 42, name: 'Test', bookCount: 1, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
        total: 1,
        page: 0,
        size: 50,
      });

      const result = await service.findAll(reqUser(), {});
      expect(result.items[0]!.lastAddedAt).toBeNull();
    });
  });

  describe('findBooks', () => {
    it('throws NotFoundException when no libraries accessible', async () => {
      libraryService.findAll.mockResolvedValue([]);
      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when series not found', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns books with series info and gap detection', async () => {
      seriesRepo.findDetail.mockResolvedValue({
        id: 42,
        name: 'Dune',
        bookCount: 3,
        readCount: 1,
        authors: ['Frank Herbert'],
        indices: [1, 2, 4],
      });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [10, 11, 12], total: 3 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date(),
            title: 'Dune',
            seriesName: 'Dune',
            seriesIndex: 1,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 11,
            status: 'present',
            folderPath: '/b',
            addedAt: new Date(),
            title: 'Dune Messiah',
            seriesName: 'Dune',
            seriesIndex: 2,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 12,
            status: 'present',
            folderPath: '/c',
            addedAt: new Date(),
            title: 'Children of Dune',
            seriesName: 'Dune',
            seriesIndex: 4,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 3,
      });

      const result = await service.findBooks(reqUser(), 42, {});

      expect(result.seriesInfo.possibleGaps).toEqual([3]);
      expect(result.seriesInfo.authors).toEqual(['Frank Herbert']);
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('preserves book order from repository', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Test', bookCount: 2, readCount: 0, authors: [], indices: [1, 2] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [20, 10], total: 2 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date(),
            title: 'B',
            seriesName: 'Test',
            seriesIndex: 2,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 20,
            status: 'present',
            folderPath: '/b',
            addedAt: new Date(),
            title: 'A',
            seriesName: 'Test',
            seriesIndex: 1,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 2,
      });

      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.items[0]!.id).toBe(20);
      expect(result.items[1]!.id).toBe(10);
    });

    it('handles empty book list gracefully', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Empty', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.items).toEqual([]);
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('rejects deep pagination', async () => {
      await expect(service.findBooks(reqUser(), 42, { page: 10000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('content filter enforcement', () => {
    it('passes contentFilters to findPage for non-superuser', async () => {
      seriesRepo.findPage.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.findAll({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(seriesRepo.findPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
    });

    it('passes undefined to findPage for superuser', async () => {
      seriesRepo.findPage.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.findAll({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(seriesRepo.findPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });

    it('passes contentFilters to findDetail and findBookIds for non-superuser', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Dune', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await service.findBooks({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 42, {});

      expect(seriesRepo.findDetail).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
      expect(seriesRepo.findBookIds).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
    });

    it('passes undefined to findDetail and findBookIds for superuser', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Dune', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await service.findBooks({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 42, {});

      expect(seriesRepo.findDetail).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
      expect(seriesRepo.findBookIds).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });
  });

  describe('findBooks - library filter empty state', () => {
    it('returns empty state when series exists in another library', async () => {
      seriesRepo.findDetail
        .mockResolvedValueOnce(null) // first call with scoped library [2]
        .mockResolvedValueOnce({ id: 42, name: 'Dune', bookCount: 5, readCount: 2, authors: ['Frank Herbert'], indices: [1, 2, 3, 4, 5] }); // second call with all libraries [1, 2]
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      const result = await service.findBooks(reqUser(), 42, { libraryId: 2 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.seriesInfo.name).toBe('Dune');
      expect(result.seriesInfo.authors).toEqual(['Frank Herbert']);
      expect(result.seriesInfo.possibleGaps).toEqual([]);
      expect(result.seriesInfo.bookCount).toBe(0);
    });

    it('throws 404 when series does not exist in any library', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await expect(service.findBooks(reqUser(), 42, { libraryId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when no library filter and series not found', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('computeGaps edge cases', () => {
    beforeEach(() => {
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
    });

    it('returns empty gaps when all indices are non-integer', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 3, readCount: 0, authors: [], indices: [0.5, 1.5, 2.5] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('returns empty gaps when min index < 1', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 2, readCount: 0, authors: [], indices: [0, 5] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('returns empty gaps when max index > 10000', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 2, readCount: 0, authors: [], indices: [1, 10001] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('handles duplicate indices', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 3, readCount: 0, authors: [], indices: [1, 1, 3] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([2]);
    });

    it('handles empty indices array', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 0, readCount: 0, authors: [], indices: [] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });
  });
});
