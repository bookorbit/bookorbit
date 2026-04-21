import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { EntityType } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { EntityManagerService } from './entity-manager.service';
import type { EntityStrategy, RawCandidatePair } from './strategies/entity-strategy.interface';

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

  const authorStrategy = mockStrategy({ entityType: 'author', isInline: false });
  const genreStrategy = mockStrategy({ entityType: 'genre', isInline: false });
  const tagStrategy = mockStrategy({ entityType: 'tag', isInline: false });
  const narratorStrategy = mockStrategy({ entityType: 'narrator', isInline: false });
  const publisherStrategy = mockStrategy({ entityType: 'publisher', isInline: true });
  const languageStrategy = mockStrategy({ entityType: 'language', isInline: true });
  const seriesStrategy = mockStrategy({ entityType: 'series', isInline: true });

  const service = new EntityManagerService(
    repo as any,
    libraryService as any,
    fileWriteService as any,
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

const mockUser: RequestUser = { id: 1, username: 'test', isSuperuser: false, permissions: [] };

describe('EntityManagerService', () => {
  describe('getStrategy', () => {
    it('returns strategy for valid entity type', () => {
      const { service } = makeService();
      expect(service.getStrategy('author')).toBeDefined();
      expect(service.getStrategy('genre')).toBeDefined();
      expect(service.getStrategy('publisher')).toBeDefined();
    });

    it('throws for unknown entity type', () => {
      const { service } = makeService();
      expect(() => service.getStrategy('unknown' as EntityType)).toThrow(BadRequestException);
    });
  });

  describe('scanDuplicates', () => {
    it('returns empty clusters when no pairs found', async () => {
      const { service } = makeService();
      const result = await service.scanDuplicates('genre', mockUser);

      expect(result.entityType).toBe('genre');
      expect(result.clusters).toEqual([]);
      expect(result.totalEntities).toBe(0);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('filters by library when libraryId provided', async () => {
      const { service, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2, 3]);

      await service.scanDuplicates('genre', mockUser, 2);

      const strategy = service.getStrategy('genre');
      expect(strategy.findCandidatePairs).toHaveBeenCalledWith([2], 0.5);
    });

    it('throws when library not accessible', async () => {
      const { service, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);

      await expect(service.scanDuplicates('genre', mockUser, 99)).rejects.toThrow(BadRequestException);
    });

    it('uses custom minSimilarity', async () => {
      const { service } = makeService();
      await service.scanDuplicates('genre', mockUser, undefined, 0.8);

      const strategy = service.getStrategy('genre');
      expect(strategy.findCandidatePairs).toHaveBeenCalledWith([1, 2], 0.8);
    });

    it('filters out dismissed pairs', async () => {
      const { service, repo, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 },
        { idA: 3, idB: 4, nameA: 'C', nameB: 'D', simScore: 0.8 },
      ];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      repo.getDismissedPairSet.mockResolvedValue(new Set(['1:2', '2:1']));

      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(2);
      (strategies.genre.getBookTitles as any).mockResolvedValue(['Book 1']);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]!.entities.map((e) => e.id).sort()).toEqual([3, 4]);
    });

    it('uses inline dismissed pair set for inline entities', async () => {
      const { service, repo } = makeService();
      await service.scanDuplicates('publisher', mockUser);

      expect(repo.getInlineDismissedPairSet).toHaveBeenCalledWith('publisher');
      expect(repo.getDismissedPairSet).not.toHaveBeenCalled();
    });

    it('builds clusters with union-find from overlapping pairs', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 },
        { idA: 2, idB: 3, nameA: 'B', nameB: 'C', simScore: 0.85 },
      ];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]!.entities).toHaveLength(3);
    });

    it('separates non-overlapping pairs into different clusters', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 },
        { idA: 3, idB: 4, nameA: 'C', nameB: 'D', simScore: 0.8 },
      ];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters).toHaveLength(2);
    });

    it('suggests target as entity with highest book count', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockImplementation((id: number) => Promise.resolve(id === 2 ? 10 : 3));
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters[0]!.suggestedTargetId).toBe(2);
    });

    it('skips clusters where entities are not found', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockResolvedValue(null);
      (strategies.genre.getBookCount as any).mockResolvedValue(0);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters).toHaveLength(0);
    });

    it('sorts clusters by average similarity descending', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.7 },
        { idA: 3, idB: 4, nameA: 'C', nameB: 'D', simScore: 0.95 },
      ];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);

      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters[0]!.averageSimilarity).toBeGreaterThan(result.clusters[1]!.averageSimilarity);
    });

    it('paginates clusters and returns total/page/pageSize', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [
        { idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 },
        { idA: 3, idB: 4, nameA: 'C', nameB: 'D', simScore: 0.8 },
        { idA: 5, idB: 6, nameA: 'E', nameB: 'F', simScore: 0.7 },
      ];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser, undefined, undefined, 1, 2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.clusters).toHaveLength(2);

      const page2 = await service.scanDuplicates('genre', mockUser, undefined, undefined, 2, 2);
      expect(page2.total).toBe(3);
      expect(page2.page).toBe(2);
      expect(page2.clusters).toHaveLength(1);
    });

    it('clamps out-of-bounds page to last valid page', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'A', nameB: 'B', simScore: 0.9 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `Entity ${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser, undefined, undefined, 99, 20);
      expect(result.page).toBe(1);
      expect(result.clusters).toHaveLength(1);
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
      });
    });
  });

  describe('merge', () => {
    it('calls strategy merge and cleans up dismissed pairs for first-class', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.author.merge as any).mockResolvedValue({
        affectedBookIds: [10, 20],
        imagePromoted: true,
        fieldsResolved: ['sortName'],
      });

      const result = await service.merge('author', mockUser, 1, [2, 3], false);

      expect(strategies.author.merge).toHaveBeenCalledWith({ targetId: 1, sourceIds: [2, 3], userId: 1 });
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledTimes(2);
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('author', 2);
      expect(repo.deleteDismissedPairsForEntity).toHaveBeenCalledWith('author', 3);
      expect(result).toEqual({
        targetId: 1,
        mergedIds: [2, 3],
        affectedBookCount: 2,
        imagePromoted: true,
        fieldsResolved: ['sortName'],
      });
    });

    it('cleans up inline dismissed pairs for inline entities', async () => {
      const { service, strategies, repo } = makeService();
      (strategies.publisher.merge as any).mockResolvedValue({ affectedBookIds: [5] });

      await service.merge('publisher', mockUser, 'Pub A', ['Pub B'], false);

      expect(repo.deleteInlineDismissedPairsForValue).toHaveBeenCalledWith('publisher', 'Pub B');
      expect(repo.deleteDismissedPairsForEntity).not.toHaveBeenCalled();
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

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'Science Fiction', nameB: 'Fiction', simScore: 0.72 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) =>
        Promise.resolve({
          id,
          name: id === 1 ? 'Science Fiction' : 'Fiction',
        }),
      );
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      const reasons = result.clusters[0]!.pairDetails[0]!.reasons;
      expect(reasons).toContain('Name containment');
    });

    it('classifies very high similarity', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'Test', nameB: 'Tset', simScore: 0.9 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) => Promise.resolve({ id, name: `E${id}` }));
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters[0]!.pairDetails[0]!.reasons).toContain('Very high name similarity');
    });

    it('adds same normalized tokens reason when applicable', async () => {
      const { service, strategies } = makeService();

      const pairs: RawCandidatePair[] = [{ idA: 1, idB: 2, nameA: 'young adult', nameB: 'Adult Young', simScore: 0.75 }];
      (strategies.genre.findCandidatePairs as any).mockResolvedValue(pairs);
      (strategies.genre.findEntityById as any).mockImplementation((id: number) =>
        Promise.resolve({
          id,
          name: id === 1 ? 'young adult' : 'Adult Young',
        }),
      );
      (strategies.genre.getBookCount as any).mockResolvedValue(1);
      (strategies.genre.getBookTitles as any).mockResolvedValue([]);

      const result = await service.scanDuplicates('genre', mockUser);
      expect(result.clusters[0]!.pairDetails[0]!.reasons).toContain('Same normalized tokens');
    });
  });
});
