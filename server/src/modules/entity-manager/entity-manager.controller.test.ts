import { EntityManagerController } from './entity-manager.controller';
import type { RequestUser } from '../../common/types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

const mockUser: RequestUser = { id: 1, username: 'test', isSuperuser: false, permissions: [], contentFilters: EMPTY_CONTENT_FILTER_RULES };

function makeController() {
  const service = {
    browse: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
    scanDuplicates: vi.fn().mockResolvedValue({ entityType: 'author', clusters: [], totalEntities: 0 }),
    merge: vi.fn().mockResolvedValue({ targetId: 1, mergedIds: [2], affectedBookCount: 3 }),
    rename: vi.fn().mockResolvedValue({ entityId: 1, oldName: 'Old', newName: 'New', affectedBookCount: 1, wasImplicitMerge: false }),
    deleteEntity: vi.fn().mockResolvedValue({ entityId: 1, name: 'Test', affectedBookCount: 0, mode: 'hard' }),
    bulkDelete: vi.fn().mockResolvedValue({ results: [], errors: [] }),
    split: vi.fn().mockResolvedValue({ originalId: 1, originalName: 'Test', newEntities: [], affectedBookCount: 0 }),
    dismissPair: vi.fn().mockResolvedValue(undefined),
    undismissPair: vi.fn().mockResolvedValue(undefined),
    getDismissedPairs: vi.fn().mockResolvedValue([]),
    getEntityInfo: vi.fn().mockResolvedValue({ id: 1, name: 'Test', bookCount: 5, bookTitles: [] }),
  };

  const controller = new EntityManagerController(service as any);

  return { controller, service };
}

describe('EntityManagerController', () => {
  describe('browse', () => {
    it('delegates to service', async () => {
      const { controller, service } = makeController();
      const result = await controller.browse('author', { search: 'test', page: 2 } as any, mockUser);

      expect(service.browse).toHaveBeenCalledWith('author', mockUser, { search: 'test', page: 2 });
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    });
  });

  describe('scanDuplicates', () => {
    it('delegates to service with query params', async () => {
      const { controller, service } = makeController();
      await controller.scanDuplicates('genre', { libraryId: 1, minSimilarity: 0.7, page: 2, pageSize: 10 } as any, mockUser);

      expect(service.scanDuplicates).toHaveBeenCalledWith('genre', mockUser, 1, 0.7, 2, 10);
    });

    it('passes undefined page/pageSize when not provided', async () => {
      const { controller, service } = makeController();
      await controller.scanDuplicates('genre', { libraryId: 1, minSimilarity: 0.7 } as any, mockUser);

      expect(service.scanDuplicates).toHaveBeenCalledWith('genre', mockUser, 1, 0.7, undefined, undefined);
    });
  });

  describe('merge', () => {
    it('handles first-class entity merge', async () => {
      const { controller, service } = makeController();
      await controller.merge('author', { targetEntityId: 1, sourceEntityIds: [2, 3], writeFiles: true } as any, mockUser);

      expect(service.merge).toHaveBeenCalledWith('author', mockUser, 1, [2, 3], true);
    });

    it('handles inline entity merge', async () => {
      const { controller, service } = makeController();
      await controller.merge('publisher', { targetValue: 'Pub A', sourceValues: ['Pub B'], writeFiles: false } as any, mockUser);

      expect(service.merge).toHaveBeenCalledWith('publisher', mockUser, 'Pub A', ['Pub B'], false);
    });

    it('defaults writeFiles to false', async () => {
      const { controller, service } = makeController();
      await controller.merge('author', { targetEntityId: 1, sourceEntityIds: [2] } as any, mockUser);

      expect(service.merge).toHaveBeenCalledWith('author', mockUser, 1, [2], false);
    });
  });

  describe('rename', () => {
    it('handles first-class entity rename', async () => {
      const { controller, service } = makeController();
      await controller.rename('tag', { entityId: 1, newName: 'New Tag' } as any, mockUser);

      expect(service.rename).toHaveBeenCalledWith('tag', mockUser, 1, 'New Tag', false);
    });

    it('handles inline entity rename', async () => {
      const { controller, service } = makeController();
      await controller.rename('publisher', { currentValue: 'Old Pub', newName: 'New Pub' } as any, mockUser);

      expect(service.rename).toHaveBeenCalledWith('publisher', mockUser, 'Old Pub', 'New Pub', false);
    });
  });

  describe('deleteEntity', () => {
    it('handles first-class entity delete', async () => {
      const { controller, service } = makeController();
      await controller.deleteEntity('genre', { entityId: 5, mode: 'hard' } as any, mockUser);

      expect(service.deleteEntity).toHaveBeenCalledWith('genre', mockUser, 5, 'hard', false);
    });

    it('handles inline entity delete', async () => {
      const { controller, service } = makeController();
      await controller.deleteEntity('language', { value: 'English' } as any, mockUser);

      expect(service.deleteEntity).toHaveBeenCalledWith('language', mockUser, 'English', 'inline', false);
    });

    it('defaults mode to hard for first-class', async () => {
      const { controller, service } = makeController();
      await controller.deleteEntity('author', { entityId: 1 } as any, mockUser);

      expect(service.deleteEntity).toHaveBeenCalledWith('author', mockUser, 1, 'hard', false);
    });
  });

  describe('bulkDelete', () => {
    it('handles first-class entity bulk delete', async () => {
      const { controller, service } = makeController();
      await controller.bulkDelete('tag', { entityIds: [1, 2, 3], mode: 'soft' } as any, mockUser);

      expect(service.bulkDelete).toHaveBeenCalledWith('tag', mockUser, [1, 2, 3], 'soft', false);
    });

    it('handles inline entity bulk delete', async () => {
      const { controller, service } = makeController();
      await controller.bulkDelete('publisher', { values: ['A', 'B'] } as any, mockUser);

      expect(service.bulkDelete).toHaveBeenCalledWith('publisher', mockUser, ['A', 'B'], 'inline', false);
    });
  });

  describe('split', () => {
    it('delegates to service', async () => {
      const { controller, service } = makeController();
      await controller.split('author', { entityId: 1, newNames: ['A', 'B'], writeFiles: true } as any, mockUser);

      expect(service.split).toHaveBeenCalledWith('author', mockUser, 1, ['A', 'B'], true);
    });
  });

  describe('dismissPair', () => {
    it('handles first-class dismiss', async () => {
      const { controller, service } = makeController();
      await controller.dismissPair('genre', { entityIdA: 1, entityIdB: 2, reason: 'not same' } as any, mockUser);

      expect(service.dismissPair).toHaveBeenCalledWith('genre', mockUser, 1, 2, 'not same');
    });

    it('handles inline dismiss', async () => {
      const { controller, service } = makeController();
      await controller.dismissPair('publisher', { valueA: 'A', valueB: 'B' } as any, mockUser);

      expect(service.dismissPair).toHaveBeenCalledWith('publisher', mockUser, 'A', 'B', undefined);
    });
  });

  describe('undismissPair', () => {
    it('handles first-class undismiss', async () => {
      const { controller, service } = makeController();
      await controller.undismissPair('genre', { entityIdA: 1, entityIdB: 2 } as any, mockUser);

      expect(service.undismissPair).toHaveBeenCalledWith('genre', mockUser, 1, 2);
    });

    it('handles inline undismiss', async () => {
      const { controller, service } = makeController();
      await controller.undismissPair('language', { valueA: 'en', valueB: 'eng' } as any, mockUser);

      expect(service.undismissPair).toHaveBeenCalledWith('language', mockUser, 'en', 'eng');
    });
  });

  describe('getDismissedPairs', () => {
    it('delegates to service', async () => {
      const { controller, service } = makeController();
      await controller.getDismissedPairs('author', mockUser);

      expect(service.getDismissedPairs).toHaveBeenCalledWith('author', mockUser);
    });
  });

  describe('getEntityInfo', () => {
    it('handles numeric entity ID', async () => {
      const { controller, service } = makeController();
      await controller.getEntityInfo('author', '42', mockUser);

      expect(service.getEntityInfo).toHaveBeenCalledWith('author', mockUser, 42);
    });

    it('handles string entity ID for inline types', async () => {
      const { controller, service } = makeController();
      await controller.getEntityInfo('publisher', 'Test Publisher', mockUser);

      expect(service.getEntityInfo).toHaveBeenCalledWith('publisher', mockUser, 'Test Publisher');
    });
  });
});
