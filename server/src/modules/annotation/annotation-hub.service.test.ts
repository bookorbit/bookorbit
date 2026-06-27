import { ConflictException, NotFoundException } from '@nestjs/common';

import { AnnotationHubService } from './annotation-hub.service';

function makeHubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    cfiStatus: 'exact',
    cfiExtras: { chapterIndex: 2 },
    text: 'selected text',
    color: 'yellow',
    style: 'highlight',
    note: 'a note',
    chapterTitle: 'Chapter 1',
    origin: 'web',
    version: 1,
    deletedAt: null,
    deviceCreatedAt: null,
    deviceUpdatedAt: null,
    createdAt: new Date('2026-01-10T00:00:00Z'),
    updatedAt: new Date('2026-01-10T00:00:00Z'),
    bookTitle: 'A Book',
    author: 'An Author',
    jumpFileId: 9,
    pageno: null,
    ...overrides,
  };
}

function makeService() {
  const annotationRepo = {
    findHubPaginated: vi.fn().mockResolvedValue({ items: [makeHubRow()], total: 1 }),
    getHubStats: vi.fn().mockResolvedValue({ books: 1, withNotes: 1, web: 1, koreader: 0, kobo: 0 }),
    findHubAll: vi.fn().mockResolvedValue([makeHubRow()]),
    findHubBookFacets: vi.fn().mockResolvedValue([{ bookId: 5, bookTitle: 'A Book', author: 'An Author', count: 3 }]),
    findHubBookFacet: vi.fn().mockResolvedValue(null),
    bulkSetDeleted: vi.fn().mockResolvedValue(2),
    bulkRestyle: vi.fn().mockResolvedValue(2),
    restore: vi.fn().mockResolvedValue(makeHubRow({ deletedAt: null })),
    findHubById: vi.fn().mockResolvedValue(makeHubRow()),
    purge: vi.fn().mockResolvedValue('purged'),
  };
  const exportService = { export: vi.fn().mockResolvedValue({ contentType: 'text/markdown', filename: 'x.md', content: '#' }) };
  const syncRepo = {
    findAnnotationById: vi.fn().mockResolvedValue({ id: 1, bookId: 5, origin: 'web', version: 3, deletedAt: null }),
    findPositionsByAnnotationIds: vi
      .fn()
      .mockResolvedValue([
        { format: 'cfi', status: 'exact', extras: { reason: null }, converterVersion: 1, updatedAt: new Date('2026-01-10T00:00:00Z') },
      ]),
    findStatesByAnnotation: vi
      .fn()
      .mockResolvedValue([
        { source: 'kobo', deviceId: '7', lastAppliedVersion: 2, deleteAckedAt: null, lastSyncedAt: new Date('2026-01-10T00:00:00Z') },
      ]),
    findKoboDeviceNames: vi.fn().mockResolvedValue(new Map([['7', 'Kobo Libra 2']])),
    updatePosition: vi.fn().mockResolvedValue(undefined),
  };
  const conversionService = { ensureCfiPositionsForBook: vi.fn().mockResolvedValue(1) };
  const service = new AnnotationHubService(annotationRepo as never, exportService as never, syncRepo as never, conversionService as never);
  return { service, annotationRepo, exportService, syncRepo, conversionService };
}

describe('AnnotationHubService', () => {
  describe('list', () => {
    it('maps the date range to Date objects and the notes-only flag into repository filters', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, {
        hasNote: true,
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-01-31T23:59:59.999Z',
        page: 2,
        pageSize: 50,
      });

      const [userId, filters, sort, page, pageSize] = annotationRepo.findHubPaginated.mock.calls[0];
      expect(userId).toBe(10);
      expect(filters.hasNote).toBe(true);
      expect(filters.dateFrom).toBeInstanceOf(Date);
      expect(filters.dateFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(filters.dateTo.toISOString()).toBe('2026-01-31T23:59:59.999Z');
      expect(filters.status).toBe('active');
      expect(sort).toEqual({ by: 'createdAt', dir: 'desc' });
      expect(page).toBe(2);
      expect(pageSize).toBe(50);
      // stats query receives the same filters so the counts match the filtered list
      expect(annotationRepo.getHubStats.mock.calls[0][1].hasNote).toBe(true);
    });

    it('omits the date range and notes-only filter when not provided', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, {});

      const filters = annotationRepo.findHubPaginated.mock.calls[0][1];
      expect(filters.hasNote).toBeUndefined();
      expect(filters.dateFrom).toBeUndefined();
      expect(filters.dateTo).toBeUndefined();
    });

    it('treats hasNote=false as no filter', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, { hasNote: false });

      expect(annotationRepo.findHubPaginated.mock.calls[0][1].hasNote).toBeUndefined();
    });

    it('passes the book sort through to the repository', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, { sortBy: 'book', sortDir: 'asc' });

      expect(annotationRepo.findHubPaginated.mock.calls[0][2]).toEqual({ by: 'book', dir: 'asc' });
    });

    it('splits comma-separated colors, styles and origins into arrays', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, { colors: '#FACC15, #4ADE80', styles: 'highlight,underline', origins: 'web , koreader' });

      const filters = annotationRepo.findHubPaginated.mock.calls[0][1];
      expect(filters.colors).toEqual(['#FACC15', '#4ADE80']);
      expect(filters.styles).toEqual(['highlight', 'underline']);
      expect(filters.origins).toEqual(['web', 'koreader']);
    });

    it('drops filter values that are empty after splitting', async () => {
      const { service, annotationRepo } = makeService();

      await service.list(10, { colors: ' , , ' });

      expect(annotationRepo.findHubPaginated.mock.calls[0][1].colors).toBeUndefined();
    });

    it('maps a trashed row with no cfi position to a null status, null chapter and a deletedAt timestamp', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findHubPaginated.mockResolvedValueOnce({
        items: [makeHubRow({ cfi: null, cfiStatus: null, cfiExtras: null, deletedAt: new Date('2026-01-05T00:00:00Z') })],
        total: 1,
      });

      const result = await service.list(10, {});

      expect(result.items[0].positionStatus).toBeNull();
      expect(result.items[0].chapterIndex).toBeNull();
      expect(result.items[0].deletedAt).toBe('2026-01-05T00:00:00.000Z');
    });

    it('returns mapped items and computed stats', async () => {
      const { service } = makeService();

      const result = await service.list(10, {});

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.items[0]).toMatchObject({ id: 1, bookId: 5, note: 'a note', chapterIndex: 2, positionStatus: 'exact' });
      expect(result.stats.books).toBe(1);
      expect(result.stats.withNotes).toBe(1);
      expect(result.stats.originBreakdown).toEqual([{ origin: 'web', count: 1 }]);
    });
  });

  describe('listBooks', () => {
    it('maps book facets and forwards the default limit', async () => {
      const { service, annotationRepo } = makeService();

      const facets = await service.listBooks(10, { status: 'active' });

      expect(annotationRepo.findHubBookFacets).toHaveBeenCalledWith(10, { status: 'active', q: undefined, limit: 20 });
      expect(facets).toEqual([{ bookId: 5, bookTitle: 'A Book', author: 'An Author', count: 3 }]);
    });

    it('forwards the search term and a custom limit', async () => {
      const { service, annotationRepo } = makeService();

      await service.listBooks(10, { status: 'trashed', q: 'dune', limit: 5 });

      expect(annotationRepo.findHubBookFacets).toHaveBeenCalledWith(10, { status: 'trashed', q: 'dune', limit: 5 });
    });

    it('pins the selected book at the top when it is outside the returned facets', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findHubBookFacet.mockResolvedValue({ bookId: 99, bookTitle: 'Pinned', author: null, count: 7 });

      const facets = await service.listBooks(10, { status: 'active', selectedId: 99 });

      expect(annotationRepo.findHubBookFacet).toHaveBeenCalledWith(10, 'active', 99);
      expect(facets[0]).toEqual({ bookId: 99, bookTitle: 'Pinned', author: null, count: 7 });
      expect(facets).toHaveLength(2);
    });

    it('does not re-fetch or duplicate the selected book when it is already present', async () => {
      const { service, annotationRepo } = makeService();

      const facets = await service.listBooks(10, { status: 'active', selectedId: 5 });

      expect(annotationRepo.findHubBookFacet).not.toHaveBeenCalled();
      expect(facets).toHaveLength(1);
    });
  });

  describe('bulk', () => {
    it('trashes the given ids', async () => {
      const { service, annotationRepo } = makeService();

      const result = await service.bulk(10, { ids: [1, 2], action: 'trash' });

      expect(annotationRepo.bulkSetDeleted).toHaveBeenCalledWith(10, [1, 2], true);
      expect(result).toEqual({ affected: 2 });
    });

    it('restores the given ids', async () => {
      const { service, annotationRepo } = makeService();

      await service.bulk(10, { ids: [1], action: 'restore' });

      expect(annotationRepo.bulkSetDeleted).toHaveBeenCalledWith(10, [1], false);
    });

    it('restyles the given ids with color and style', async () => {
      const { service, annotationRepo } = makeService();

      await service.bulk(10, { ids: [1], action: 'restyle', color: '#38BDF8', style: 'underline' });

      expect(annotationRepo.bulkRestyle).toHaveBeenCalledWith(10, [1], { color: '#38BDF8', style: 'underline' });
    });
  });

  describe('restore', () => {
    it('restores and returns the refreshed hub item', async () => {
      const { service } = makeService();

      const result = await service.restore(10, 1);

      expect(result).toMatchObject({ id: 1, bookId: 5 });
    });

    it('throws NotFoundException when the annotation is not in trash', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.restore.mockResolvedValueOnce(null);

      await expect(service.restore(10, 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('falls back to the restored row when the hub re-read misses', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findHubById.mockResolvedValueOnce(null);

      const result = await service.restore(10, 1);

      expect(result).toMatchObject({ id: 1, cfi: null });
    });
  });

  describe('purge', () => {
    it('resolves when the annotation is purged', async () => {
      const { service } = makeService();

      await expect(service.purge(10, 1)).resolves.toBeUndefined();
    });

    it('throws ConflictException when a device still has it queued', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.purge.mockResolvedValueOnce('pending_device_sync');

      await expect(service.purge(10, 1)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when nothing matched', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.purge.mockResolvedValueOnce('not_found');

      await expect(service.purge(10, 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('syncDetail', () => {
    it('returns positions and per-device sync info with kobo display names', async () => {
      const { service } = makeService();

      const detail = await service.syncDetail(10, 1);

      expect(detail.annotationId).toBe(1);
      expect(detail.version).toBe(3);
      expect(detail.positions[0]).toMatchObject({ format: 'cfi', status: 'exact', reason: null });
      expect(detail.devices[0]).toMatchObject({ source: 'kobo', deviceName: 'Kobo Libra 2', upToDate: false });
    });

    it('marks a deleted annotation up to date once the device acknowledged the deletion', async () => {
      const { service, syncRepo } = makeService();
      syncRepo.findAnnotationById.mockResolvedValueOnce({
        id: 1,
        bookId: 5,
        origin: 'koreader',
        version: 3,
        deletedAt: new Date('2026-01-05T00:00:00Z'),
      });
      syncRepo.findStatesByAnnotation.mockResolvedValueOnce([
        {
          source: 'koreader',
          deviceId: 'kdev',
          lastAppliedVersion: 1,
          deleteAckedAt: new Date('2026-01-06T00:00:00Z'),
          lastSyncedAt: new Date('2026-01-06T00:00:00Z'),
        },
      ]);

      const detail = await service.syncDetail(10, 1);

      expect(detail.devices[0].upToDate).toBe(true);
      expect(detail.devices[0].deleteAckedAt).toBe('2026-01-06T00:00:00.000Z');
      expect(detail.devices[0].deviceName).toBeNull();
    });

    it('throws NotFoundException for an unknown annotation', async () => {
      const { service, syncRepo } = makeService();
      syncRepo.findAnnotationById.mockResolvedValueOnce(null);

      await expect(service.syncDetail(10, 99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('retryPosition', () => {
    it('marks the cfi position pending and recomputes it immediately', async () => {
      const { service, syncRepo, conversionService } = makeService();

      await service.retryPosition(10, 1, 'cfi');

      expect(syncRepo.updatePosition).toHaveBeenCalledWith(1, 'cfi', { status: 'pending', converterVersion: null });
      expect(conversionService.ensureCfiPositionsForBook).toHaveBeenCalledWith(10, 5);
    });

    it('does not run cfi conversion for device formats', async () => {
      const { service, conversionService } = makeService();

      await service.retryPosition(10, 1, 'xpointer');

      expect(conversionService.ensureCfiPositionsForBook).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown annotation', async () => {
      const { service, syncRepo } = makeService();
      syncRepo.findAnnotationById.mockResolvedValueOnce(null);

      await expect(service.retryPosition(10, 99, 'cfi')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('export', () => {
    it('forwards the notes-only and date filters to the repository and the export service', async () => {
      const { service, annotationRepo, exportService } = makeService();

      const result = await service.export(10, { hasNote: true, dateFrom: '2026-01-01T00:00:00.000Z', format: 'csv' }, 'library');

      const filters = annotationRepo.findHubAll.mock.calls[0][1];
      expect(filters.hasNote).toBe(true);
      expect(filters.dateFrom).toBeInstanceOf(Date);
      expect(exportService.export).toHaveBeenCalledWith([makeHubRow()], 'csv', 'library');
      expect(result.filename).toBe('x.md');
    });

    it('defaults the export format to markdown when omitted', async () => {
      const { service, exportService } = makeService();

      await service.export(10, {}, 'library');

      expect(exportService.export.mock.calls[0][1]).toBe('md');
    });
  });
});
