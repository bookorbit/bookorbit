import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { EntityType } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { EntityManagerService } from './entity-manager.service';
import type { EntityStrategy, RawCandidatePair } from './strategies/entity-strategy.interface';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function mockStrategy(overrides: Partial<EntityStrategy> & { entityType: EntityType; isInline: boolean }): EntityStrategy {
  return {
    findCandidatePairs: vi.fn().mockResolvedValue([]),
    browse: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    merge: vi.fn().mockResolvedValue({ affectedBookIds: [] }),
    rename: vi.fn().mockResolvedValue({ oldName: 'Old', affectedBookIds: [], wasImplicitMerge: false }),
    deleteEntity: vi.fn().mockResolvedValue({ name: 'Test', affectedBookIds: [] }),
    split: vi.fn().mockResolvedValue({ originalName: 'Test', newEntities: [], affectedBookIds: [] }),
    findAffectedBookIds: vi.fn().mockResolvedValue([]),
    getBookCount: vi.fn().mockResolvedValue(0),
    getBookTitles: vi.fn().mockResolvedValue([]),
    findEntityById: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeService() {
  const repo = {
    getDismissedPairSet: vi.fn().mockResolvedValue(new Set<string>()),
    getInlineDismissedPairSet: vi.fn().mockResolvedValue(new Set<string>()),
    insertDismissedPair: vi.fn().mockResolvedValue(undefined),
    deleteDismissedPair: vi.fn().mockResolvedValue(undefined),
    deleteDismissedPairsForEntity: vi.fn().mockResolvedValue(undefined),
    insertInlineDismissedPair: vi.fn().mockResolvedValue(undefined),
    deleteInlineDismissedPair: vi.fn().mockResolvedValue(undefined),
    deleteInlineDismissedPairsForValue: vi.fn().mockResolvedValue(undefined),
    findDismissedPairs: vi.fn().mockResolvedValue([]),
    findInlineDismissedPairs: vi.fn().mockResolvedValue([]),
  };

  const libraryService = {
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([1, 2]),
  };

  const fileWriteService = {
    scheduleWrite: vi.fn(),
  };

  const duplicateCompute = {
    readCandidatePairs: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(null),
    triggerCompute: vi.fn(),
    invalidateCandidatesForEntities: vi.fn().mockResolvedValue(undefined),
  };

  const authorStrategy = mockStrategy({ entityType: 'author', isInline: false });
  const genreStrategy = mockStrategy({ entityType: 'genre', isInline: false });
  const tagStrategy = mockStrategy({ entityType: 'tag', isInline: false });
  const narratorStrategy = mockStrategy({ entityType: 'narrator', isInline: false });
  const publisherStrategy = mockStrategy({ entityType: 'publisher', isInline: true });
  const languageStrategy = mockStrategy({ entityType: 'language', isInline: true });
  const seriesStrategy = mockStrategy({ entityType: 'series', isInline: false });

  const service = new EntityManagerService(
    repo as any,
    libraryService as any,
    fileWriteService as any,
    duplicateCompute as any,
    authorStrategy as any,
    genreStrategy as any,
    tagStrategy as any,
    narratorStrategy as any,
    publisherStrategy as any,
    languageStrategy as any,
    seriesStrategy as any,
  );

  return {
    service,
    repo,
    libraryService,
    fileWriteService,
    duplicateCompute,
    strategies: {
      author: authorStrategy,
      genre: genreStrategy,
      tag: tagStrategy,
      narrator: narratorStrategy,
      publisher: publisherStrategy,
      language: languageStrategy,
      series: seriesStrategy,
    },
  };
}

const mockUser: RequestUser = { id: 1, username: 'test', isSuperuser: false, permissions: [], contentFilters: EMPTY_CONTENT_FILTER_RULES };

describe('EntityManagerService', () => {
  describe('getStrategy', () => {
    it('returns strategy for valid entity type', () => {
      const { service } = makeService();
      expect(service.getStrategy('author')).toBeDefined();
      expect(service.getStrategy('genre')).toBeDefined();
      expect(service.getStrategy('publisher')).toBeDefined();
      expect(service.getStrategy('series')).toBeDefined();
    });

    it('throws for unknown entity type', () => {
      const { service } = makeService();
      expect(() => service.getStrategy('unknown' as EntityType)).toThrow(BadRequestException);
    });
  });

  describe('scanDuplicates', () => {
    it('returns empty clusters when no pairs found', async () => {
      const { service } = makeService();
      const result = await service.scanDuplicates('author', mockUser);

      expect(result.entityType).toBe('author');
      expect(result.clusters).toEqual([]);
      expect(result.totalEntities).toBe(0);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('filters by library when libraryId provided for inline entities', async () => {
      const { service, libraryService, strategies } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2, 3]);

      await service.scanDuplicates('publisher', mockUser, 2);

      expect(strategies.publisher.findCandidatePairs).toHaveBeenCalledWith([2], 0.5);
    });

    it('throws when library not accessible', async () => {
      const { service, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);

      await expect(service.scanDuplicates('publisher', mockUser, 99)).rejects.toThrow(BadRequestException);
    });

    it('uses custom minSimilarity for inline entities', async () => {
      const { service, strategies } = makeService();
      await service.scanDuplicates('publisher', mockUser, undefined, 0.8);

      expect(strategies.publisher.findCandidatePairs).toHaveBeenCalledWith([1, 2], 0.8);
    });

    it('filters out dismissed pairs for inline entities', async () => {
      const { service, repo, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.9 },
        { idA: 'Pub C', idB: 'Pub D', nameA: 'Pub C', nameB: 'Pub D', simScore: 0.8 },
      ];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      repo.getInlineDismissedPairSet.mockResolvedValue(new Set(['Pub A:Pub B', 'Pub B:Pub A']));

      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(2);
      (strategies.publisher.getBookTitles as any).mockResolvedValue(['Book 1']);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]!.entities.map((e) => e.id).sort()).toEqual(['Pub C', 'Pub D']);
    });

    it('uses inline dismissed pair set for inline entities', async () => {
      const { service, repo } = makeService();
      await service.scanDuplicates('publisher', mockUser);

      expect(repo.getInlineDismissedPairSet).toHaveBeenCalledWith('publisher');
      expect(repo.getDismissedPairSet).not.toHaveBeenCalled();
    });

    it('builds clusters with union-find from overlapping inline pairs', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.9 },
        { idA: 'Pub B', idB: 'Pub C', nameA: 'Pub B', nameB: 'Pub C', simScore: 0.85 },
      ];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]!.entities).toHaveLength(3);
    });

    it('separates non-overlapping inline pairs into different clusters', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.9 },
        { idA: 'Pub C', idB: 'Pub D', nameA: 'Pub C', nameB: 'Pub D', simScore: 0.8 },
      ];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters).toHaveLength(2);
    });

    it('suggests target as entity with highest book count', async () => {
      const { service, duplicateCompute, strategies } = makeService();
      duplicateCompute.readCandidatePairs.mockResolvedValue([{ idA: 1, idB: 2, simScore: 0.9 }]);

      (strategies.author.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.author.getBookCount as any).mockImplementation((id: number) => Promise.resolve(id === 2 ? 10 : 3));
      (strategies.author.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('author', mockUser);
      expect(result.clusters[0]!.suggestedTargetId).toBe(2);
    });

    it('skips clusters where entities are not found', async () => {
      const { service, duplicateCompute, strategies } = makeService();
      duplicateCompute.readCandidatePairs.mockResolvedValue([{ idA: 1, idB: 2, simScore: 0.9 }]);
      (strategies.author.findEntityById as any).mockResolvedValue(null);
      (strategies.author.getBookCount as any).mockResolvedValue(0);
      (strategies.author.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('author', mockUser);
      expect(result.clusters).toHaveLength(0);
    });

    it('sorts inline clusters by average similarity descending', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.7 },
        { idA: 'Pub C', idB: 'Pub D', nameA: 'Pub C', nameB: 'Pub D', simScore: 0.95 },
      ];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters[0]!.averageSimilarity).toBeGreaterThan(result.clusters[1]!.averageSimilarity);
    });

    it('paginates clusters and returns total, page, and pageSize', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.9 },
        { idA: 'Pub C', idB: 'Pub D', nameA: 'Pub C', nameB: 'Pub D', simScore: 0.8 },
        { idA: 'Pub E', idB: 'Pub F', nameA: 'Pub E', nameB: 'Pub F', simScore: 0.7 },
      ];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser, undefined, undefined, 1, 2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.clusters).toHaveLength(2);

      const page2 = await service.scanDuplicates('publisher', mockUser, undefined, undefined, 2, 2);
      expect(page2.total).toBe(3);
      expect(page2.page).toBe(2);
      expect(page2.clusters).toHaveLength(1);
    });

    it('clamps out-of-bounds page to last valid page', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 'Pub A', idB: 'Pub B', nameA: 'Pub A', nameB: 'Pub B', simScore: 0.9 }];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser, undefined, undefined, 99, 20);
      expect(result.page).toBe(1);
      expect(result.clusters).toHaveLength(1);
    });

    it('builds non-inline clusters from stored candidate pairs', async () => {
      const { service, repo, duplicateCompute, strategies } = makeService();
      duplicateCompute.readCandidatePairs.mockResolvedValue([
        { idA: 1, idB: 2, simScore: 0.92 },
        { idA: 2, idB: 3, simScore: 0.88 },
      ]);
      (strategies.author.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Author ${id}` }));
      (strategies.author.getBookCount as any).mockResolvedValue(1);
      (strategies.author.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('author', mockUser);

      expect(duplicateCompute.readCandidatePairs).toHaveBeenCalledWith('author', 0.5);
      expect(repo.getDismissedPairSet).not.toHaveBeenCalled();
      expect(strategies.author.findCandidatePairs).not.toHaveBeenCalled();
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]!.entities).toHaveLength(3);
    });

    it('triggers duplicate compute with the requested threshold when no status exists', async () => {
      const { service, duplicateCompute, strategies } = makeService();

      await service.scanDuplicates('author', mockUser, undefined, 0.73);

      expect(duplicateCompute.getStatus).toHaveBeenCalledWith('author');
      expect(duplicateCompute.triggerCompute).toHaveBeenCalledWith('author', strategies.author, 0.73);
    });

    it('triggers duplicate compute when stored threshold is higher than requested', async () => {
      const { service, duplicateCompute, strategies } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: false,
        computedAt: new Date('2024-01-01T00:00:00.000Z'),
        totalPairs: 0,
        threshold: 0.9,
        totalCount: 10,
        processedCount: 10,
        errorMessage: null,
      });

      await service.scanDuplicates('author', mockUser, undefined, 0.7);

      expect(duplicateCompute.triggerCompute).toHaveBeenCalledWith('author', strategies.author, 0.7);
    });

    it('does not trigger duplicate compute when stored threshold already covers the request', async () => {
      const { service, duplicateCompute } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: false,
        computedAt: new Date('2024-01-01T00:00:00.000Z'),
        totalPairs: 0,
        threshold: 0.6,
        totalCount: 10,
        processedCount: 10,
        errorMessage: null,
      });

      await service.scanDuplicates('author', mockUser, undefined, 0.7);

      expect(duplicateCompute.triggerCompute).not.toHaveBeenCalled();
    });

    it('uses entity names when computing reasons for stored pairs', async () => {
      const { service, duplicateCompute, strategies } = makeService();
      duplicateCompute.readCandidatePairs.mockResolvedValue([{ idA: 1, idB: 2, simScore: 0.75 }]);
      (strategies.author.findEntityById as any).mockImplementation((id: number) =>
        Promise.resolve({ id, name: id === 1 ? 'young adult' : 'Adult Young' }),
      );
      (strategies.author.getBookCount as any).mockResolvedValue(1);
      (strategies.author.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('author', mockUser);
      expect(result.clusters[0]!.pairDetails[0]!.reasons).toContain('Same normalized tokens');
    });
  });

  describe('getDuplicateScanStatus', () => {
    it('returns idle when no status row exists', async () => {
      const { service, duplicateCompute } = makeService();
      duplicateCompute.getStatus.mockResolvedValue(null);

      await expect(service.getDuplicateScanStatus('author')).resolves.toEqual({
        entityType: 'author',
        state: 'idle',
        computedAt: null,
        totalPairs: null,
        threshold: null,
        progressPct: null,
      });
    });

    it('returns computing with progress percentage', async () => {
      const { service, duplicateCompute } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: true,
        computedAt: null,
        totalPairs: null,
        threshold: 0.7,
        totalCount: 20,
        processedCount: 5,
        errorMessage: null,
      });

      await expect(service.getDuplicateScanStatus('author')).resolves.toEqual({
        entityType: 'author',
        state: 'computing',
        computedAt: null,
        totalPairs: null,
        threshold: 0.7,
        progressPct: 25,
      });
    });

    it('returns done when computation completed', async () => {
      const { service, duplicateCompute } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: false,
        computedAt: new Date('2024-01-01T00:00:00.000Z'),
        totalPairs: 12,
        threshold: 0.8,
        totalCount: 20,
        processedCount: 20,
        errorMessage: null,
      });

      await expect(service.getDuplicateScanStatus('author')).resolves.toEqual({
        entityType: 'author',
        state: 'done',
        computedAt: '2024-01-01T00:00:00.000Z',
        totalPairs: 12,
        threshold: 0.8,
        progressPct: null,
      });
    });

    it('returns error when the last compute failed', async () => {
      const { service, duplicateCompute } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: false,
        computedAt: null,
        totalPairs: null,
        threshold: 0.7,
        totalCount: 20,
        processedCount: 4,
        errorMessage: 'boom',
      });

      await expect(service.getDuplicateScanStatus('author')).resolves.toEqual({
        entityType: 'author',
        state: 'error',
        computedAt: null,
        totalPairs: null,
        threshold: 0.7,
        progressPct: null,
      });
    });

    it('returns done immediately for inline entity types', async () => {
      const { service, duplicateCompute } = makeService();

      await expect(service.getDuplicateScanStatus('publisher')).resolves.toEqual({
        entityType: 'publisher',
        state: 'done',
        computedAt: null,
        totalPairs: null,
        threshold: null,
        progressPct: null,
      });
      expect(duplicateCompute.getStatus).not.toHaveBeenCalled();
    });
  });

  describe('refreshDuplicates', () => {
    it('calls triggerCompute for non-inline entities and returns status', async () => {
      const { service, duplicateCompute, strategies } = makeService();
      duplicateCompute.getStatus.mockResolvedValue({
        entityType: 'author',
        isComputing: true,
        computedAt: null,
        totalPairs: null,
        threshold: 0.72,
        totalCount: 10,
        processedCount: 1,
        errorMessage: null,
      });

      const result = await service.refreshDuplicates('author', 0.72);

      expect(duplicateCompute.triggerCompute).toHaveBeenCalledWith('author', strategies.author, 0.72);
      expect(result).toEqual({
        entityType: 'author',
        state: 'computing',
        computedAt: null,
        totalPairs: null,
        threshold: 0.72,
        progressPct: 10,
      });
    });

    it('does not call triggerCompute for inline entities', async () => {
      const { service, duplicateCompute } = makeService();

      const result = await service.refreshDuplicates('publisher', 0.72);

      expect(duplicateCompute.triggerCompute).not.toHaveBeenCalled();
      expect(result).toEqual({
        entityType: 'publisher',
        state: 'done',
        computedAt: null,
        totalPairs: null,
        threshold: null,
        progressPct: null,
      });
    });
  });

  describe('browse', () => {
    it('delegates to strategy with default params', async () => {
      const { service, strategies } = makeService();
      (strategies.author.browse as any).mockResolvedValue({
        items: [{ id: 1, name: 'Author', bookCount: 5 }],
        total: 1,
      });

      const result = await service.browse('author', mockUser, {});

      expect(strategies.author.browse).toHaveBeenCalledWith({
        libraryIds: [1, 2],
        search: undefined,
        page: 1,
        pageSize: 25,
        sortBy: 'name',
        sortOrder: 'asc',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('passes custom params', async () => {
      const { service, strategies } = makeService();
      (strategies.tag.browse as any).mockResolvedValue({ items: [], total: 0 });

      await service.browse('tag', mockUser, { search: 'fic', page: 2, pageSize: 50, sortBy: 'bookCount', sortOrder: 'desc' });

      expect(strategies.tag.browse).toHaveBeenCalledWith({
        libraryIds: [1, 2],
        search: 'fic',
        page: 2,
        pageSize: 50,
        sortBy: 'bookCount',
        sortOrder: 'desc',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
    });
  });

  describe('merge', () => {
    it('calls strategy merge and cleans up dismissed pairs for first-class', async () => {
      const { service, strategies, repo, duplicateCompute } = makeService();
      (strategies.author.merge as any).mockResolvedValue({
        affectedBookIds: [10, 20],
        imagePromoted: true,
        fieldsResolved: ['sortName'],
      });

      const result = await service.merge('author', mockUser, 1, [2, 3], false);

      expect(strategies.author.merge).toHaveBeenCalledWith({ targetId: 1, sourceIds: [2, 3], userId: 1, libraryIds: [1, 2] });
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledTimes(2);
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('author', 2);
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('author', 3);
      expect(duplicateCompute.invalidateCandidatesForEntities).toHaveBeenCalledTimes(1);
      expect(duplicateCompute.invalidateCandidatesForEntities).toHaveBeenCalledWith('author', [2, 3]);
      expect(result).toEqual({
        targetId: 1,
        mergedIds: [2, 3],
        affectedBookCount: 2,
        imagePromoted: true,
        fieldsResolved: ['sortName'],
      });
    });

    it('invalidates candidate rows once for all merged source IDs', async () => {
      const { service, strategies, duplicateCompute } = makeService();
      (strategies.author.merge as any).mockResolvedValue({ affectedBookIds: [] });

      await service.merge('author', mockUser, 1, [2, 3, 4], false);

      expect(duplicateCompute.invalidateCandidatesForEntities).toHaveBeenCalledTimes(1);
      expect(duplicateCompute.invalidateCandidatesForEntities).toHaveBeenCalledWith('author', [2, 3, 4]);
    });

    it('cleans up inline dismissed pairs for inline entities', async () => {
      const { service, strategies, repo, duplicateCompute } = makeService();
      (strategies.publisher.merge as any).mockResolvedValue({ affectedBookIds: [5] });

      await service.merge('publisher', mockUser, 'Pub A', ['Pub B'], false);

      expect(repo.deleteInlineDismissedPairsForValue).toHaveBeenCalledWith('publisher', 'Pub B');
      expect(repo.deleteDismissedPairsForEntity).not.toHaveBeenCalled();
      expect(duplicateCompute.invalidateCandidatesForEntities).not.toHaveBeenCalled();
    });

    it('schedules file writes when writeFiles is true', async () => {
      const { service, strategies, fileWriteService } = makeService();
      (strategies.genre.merge as any).mockResolvedValue({ affectedBookIds: [10, 20, 10] });

      await service.merge('genre', mockUser, 1, [2], true);

      expect(fileWriteService.scheduleWrite).toHaveBeenCalledTimes(2);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(10, 'auto', 1);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(20, 'auto', 1);
    });

    it('does not schedule file writes when writeFiles is false', async () => {
      const { service, strategies, fileWriteService } = makeService();
      (strategies.genre.merge as any).mockResolvedValue({ affectedBookIds: [10] });

      await service.merge('genre', mockUser, 1, [2], false);

      expect(fileWriteService.scheduleWrite).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('calls strategy rename and returns result', async () => {
      const { service, strategies } = makeService();
      (strategies.tag.rename as any).mockResolvedValue({
        oldName: 'OldTag',
        affectedBookIds: [5, 6],
        wasImplicitMerge: false,
      });

      const result = await service.rename('tag', mockUser, 1, ' NewTag ', false);

      expect(strategies.tag.rename).toHaveBeenCalledWith({ entityId: 1, newName: ' NewTag ', userId: 1, libraryIds: [1, 2] });
      expect(result).toEqual({
        entityId: 1,
        oldName: 'OldTag',
        newName: 'NewTag',
        affectedBookCount: 2,
        wasImplicitMerge: false,
        mergedEntityId: undefined,
      });
    });

    it('schedules file writes when writeFiles is true', async () => {
      const { service, strategies, fileWriteService } = makeService();
      (strategies.tag.rename as any).mockResolvedValue({
        oldName: 'Old',
        affectedBookIds: [1],
        wasImplicitMerge: false,
      });

      await service.rename('tag', mockUser, 1, 'New', true);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(1, 'auto', 1);
    });
  });

  describe('deleteEntity', () => {
    it('calls strategy delete and cleans dismissed pairs for hard delete', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.genre.deleteEntity as any).mockResolvedValue({ name: 'Fantasy', affectedBookIds: [1, 2] });

      const result = await service.deleteEntity('genre', mockUser, 5, 'hard', false);

      expect(strategies.genre.deleteEntity).toHaveBeenCalledWith({ entityId: 5, mode: 'hard', libraryIds: [1, 2] });
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('genre', 5);
      expect(result).toEqual({ entityId: 5, name: 'Fantasy', affectedBookCount: 2, mode: 'hard' });
    });

    it('does not clean dismissed pairs for soft delete', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.genre.deleteEntity as any).mockResolvedValue({ name: 'Fantasy', affectedBookIds: [] });

      await service.deleteEntity('genre', mockUser, 5, 'soft', false);

      expect(repo.deleteDismissedPairsForEntity).not.toHaveBeenCalled();
    });

    it('cleans inline dismissed pairs for inline entities', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.language.deleteEntity as any).mockResolvedValue({ name: 'English', affectedBookIds: [3] });

      await service.deleteEntity('language', mockUser, 'English', 'inline', false);

      expect(repo.deleteInlineDismissedPairsForValue).toHaveBeenCalledWith('language', 'English');
      expect(repo.deleteDismissedPairsForEntity).not.toHaveBeenCalled();
    });

    it('schedules file writes when writeFiles is true', async () => {
      const { service, strategies, fileWriteService } = makeService();
      (strategies.genre.deleteEntity as any).mockResolvedValue({ name: 'Fantasy', affectedBookIds: [10] });

      await service.deleteEntity('genre', mockUser, 5, 'hard', true);

      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(10, 'auto', 1);
    });
  });

  describe('bulkDelete', () => {
    it('deletes multiple entities and returns results', async () => {
      const { service, strategies } = makeService();
      (strategies.tag.deleteEntity as any).mockResolvedValue({ name: 'Tag', affectedBookIds: [] });

      const result = await service.bulkDelete('tag', mockUser, [1, 2, 3], 'hard', false);

      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors for individual failures', async () => {
      const { service, strategies } = makeService();
      (strategies.tag.deleteEntity as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ name: 'Tag1', affectedBookIds: [] })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({ name: 'Tag3', affectedBookIds: [] });

      const result = await service.bulkDelete('tag', mockUser, [1, 2, 3], 'hard', false);

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.entityId).toBe(2);
    });
  });

  describe('split', () => {
    it('calls strategy split and cleans dismissed pairs', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.author.split as any).mockResolvedValue({
        originalName: 'Author',
        newEntities: [
          { id: 10, name: 'Author A' },
          { id: 11, name: 'Author B' },
        ],
        affectedBookIds: [1, 2],
      });

      const result = await service.split('author', mockUser, 5, ['Author A', 'Author B'], false);

      expect(strategies.author.split).toHaveBeenCalledWith({ entityId: 5, newNames: ['Author A', 'Author B'] });
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('author', 5);
      expect(result).toEqual({
        originalId: 5,
        originalName: 'Author',
        newEntities: [
          { id: 10, name: 'Author A' },
          { id: 11, name: 'Author B' },
        ],
        affectedBookCount: 2,
      });
    });

    it('throws for inline entity types', async () => {
      const { service } = makeService();
      await expect(service.split('publisher', mockUser, 1, ['A', 'B'], false)).rejects.toThrow(BadRequestException);
    });

    it('throws when fewer than 2 new names', async () => {
      const { service } = makeService();
      await expect(service.split('author', mockUser, 1, ['Only one'], false)).rejects.toThrow(BadRequestException);
    });

    it('schedules file writes when writeFiles is true', async () => {
      const { service, strategies, fileWriteService } = makeService();
      (strategies.genre.split as any).mockResolvedValue({
        originalName: 'Genre',
        newEntities: [{ id: 10, name: 'A' }],
        affectedBookIds: [1, 2],
      });

      await service.split('genre', mockUser, 5, ['A', 'B'], true);

      expect(fileWriteService.scheduleWrite).toHaveBeenCalledTimes(2);
    });
  });

  describe('dismissPair', () => {
    it('inserts first-class dismissed pair', async () => {
      const { service, repo } = makeService();
      await service.dismissPair('author', mockUser, 1, 2, 'not same');

      expect(repo.insertDismissedPair).toHaveBeenCalledWith('author', 1, 2, 'not same', 1);
    });

    it('inserts inline dismissed pair', async () => {
      const { service, repo } = makeService();
      await service.dismissPair('publisher', mockUser, 'Pub A', 'Pub B', 'different');

      expect(repo.insertInlineDismissedPair).toHaveBeenCalledWith('publisher', 'Pub A', 'Pub B', 'different', 1);
    });
  });

  describe('undismissPair', () => {
    it('deletes first-class dismissed pair', async () => {
      const { service, repo } = makeService();
      await service.undismissPair('genre', mockUser, 1, 2);

      expect(repo.deleteDismissedPair).toHaveBeenCalledWith('genre', 1, 2);
    });

    it('deletes inline dismissed pair', async () => {
      const { service, repo } = makeService();
      await service.undismissPair('language', mockUser, 'en', 'eng');

      expect(repo.deleteInlineDismissedPair).toHaveBeenCalledWith('language', 'en', 'eng');
    });
  });

  describe('getDismissedPairs', () => {
    it('returns enriched dismissed pairs for first-class entities', async () => {
      const { service, repo, strategies } = makeService();
      repo.findDismissedPairs.mockResolvedValue([{ id: 1, entityIdA: 10, entityIdB: 20, reason: 'test', dismissedAt: new Date('2024-01-01') }]);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Genre ${id}` }));

      const result = await service.getDismissedPairs('genre', mockUser);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        entityType: 'genre',
        nameA: 'Genre 10',
        nameB: 'Genre 20',
        idA: 10,
        idB: 20,
        reason: 'test',
        dismissedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('skips pairs where entity no longer exists', async () => {
      const { service, repo, strategies } = makeService();
      repo.findDismissedPairs.mockResolvedValue([{ id: 1, entityIdA: 10, entityIdB: 20, reason: null, dismissedAt: new Date() }]);
      (strategies.genre.findEntityById as any).mockResolvedValueOnce({ id: 10, name: 'A' }).mockResolvedValueOnce(null);

      const result = await service.getDismissedPairs('genre', mockUser);
      expect(result).toHaveLength(0);
    });

    it('returns inline dismissed pairs directly', async () => {
      const { service, repo } = makeService();
      repo.findInlineDismissedPairs.mockResolvedValue([
        { id: 1, valueA: 'Pub A', valueB: 'Pub B', reason: null, dismissedAt: new Date('2024-06-01') },
      ]);

      const result = await service.getDismissedPairs('publisher', mockUser);

      expect(result).toHaveLength(1);
      expect(result[0]!.nameA).toBe('Pub A');
      expect(result[0]!.idA).toBe('Pub A');
    });
  });

  describe('getEntityInfo', () => {
    it('returns entity info with book count and titles', async () => {
      const { service, strategies } = makeService();
      (strategies.author.findEntityById as any).mockResolvedValue({ id: 1, name: 'Author A' });
      (strategies.author.getBookCount as any).mockResolvedValue(5);
      (strategies.author.getBookTitles as any).mockResolvedValue(['Book 1', 'Book 2']);

      const result = await service.getEntityInfo('author', 1);

      expect(result).toEqual({ id: 1, name: 'Author A', bookCount: 5, bookTitles: ['Book 1', 'Book 2'] });
    });

    it('throws NotFoundException when entity not found', async () => {
      const { service, strategies } = makeService();
      (strategies.author.findEntityById as any).mockResolvedValue(null);

      await expect(service.getEntityInfo('author', 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('computeReasons (via scan)', () => {
    it('adds name containment reason when one name contains the other', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 'A', idB: 'B', nameA: 'Science Fiction', nameB: 'Fiction', simScore: 0.72 }];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.publisher.findEntityById as any).mockImplementation((id: string) =>
        Promise.resolve({ id, name: id === 'A' ? 'Science Fiction' : 'Fiction' }),
      );
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      const reasons = result.clusters[0]!.pairDetails[0]!.reasons;
      expect(reasons).toContain('Name containment');
    });

    it('classifies very high similarity', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 'A', idB: 'B', nameA: 'Test', nameB: 'Tset', simScore: 0.9 }];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.publisher.findEntityById as any).mockImplementation((id: string) => Promise.resolve({ id, name: id === 'A' ? 'Test' : 'Tset' }));
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters[0]!.pairDetails[0]!.reasons).toContain('Very high name similarity');
    });

    it('adds same normalized tokens reason when applicable', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 'A', idB: 'B', nameA: 'young adult', nameB: 'Adult Young', simScore: 0.75 }];
      (strategies.publisher.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.publisher.findEntityById as any).mockImplementation((id: string) =>
        Promise.resolve({ id, name: id === 'A' ? 'young adult' : 'Adult Young' }),
      );
      (strategies.publisher.getBookCount as any).mockResolvedValue(1);
      (strategies.publisher.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('publisher', mockUser);
      expect(result.clusters[0]!.pairDetails[0]!.reasons).toContain('Same normalized tokens');
    });
  });
});
