import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';

import type { BookQuery } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { CollectionController } from './collection.controller';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

const USER: RequestUser = {
  id: 1,
  username: 'collector',
  name: 'Collector',
  email: null,
  active: true,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  isSuperuser: false,
  permissions: [],

  contentFilters: EMPTY_CONTENT_FILTER_RULES,
};

function makeController() {
  const service = {
    findAll: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    reorder: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addBooks: vi.fn(),
    removeBooks: vi.fn(),
    getBooks: vi.fn(),
    queryBooks: vi.fn(),
    queryJumpBuckets: vi.fn(),
  };
  const controller = new CollectionController(service as never);
  return { controller, service };
}

async function expectBadRequest(fn: () => unknown | Promise<unknown>) {
  await expect(Promise.resolve().then(fn)).rejects.toBeInstanceOf(BadRequestException);
}

describe('CollectionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('delegates to service without membership filter when bookIds query is absent', async () => {
      const { controller, service } = makeController();
      service.findAll.mockResolvedValue([]);

      await controller.findAll(USER);

      expect(service.findAll).toHaveBeenCalledWith(USER);
    });

    it('parses, validates, and deduplicates a valid bookIds query', async () => {
      const { controller, service } = makeController();
      service.findAll.mockResolvedValue([]);

      await controller.findAll(USER, '8, 3,8,5');

      expect(service.findAll).toHaveBeenCalledWith(USER, [8, 3, 5]);
    });

    it('rejects malformed bookIds queries', async () => {
      const { controller } = makeController();

      await expectBadRequest(() => controller.findAll(USER, '8,'));
      await expectBadRequest(() => controller.findAll(USER, '1,two'));
      await expectBadRequest(() => controller.findAll(USER, '-1,2'));
      await expectBadRequest(() => controller.findAll(USER, '0,2'));
      await expectBadRequest(() => controller.findAll(USER, '   '));
    });
  });

  describe('getBooks', () => {
    it('delegates valid pagination queries to the service', async () => {
      const { controller, service } = makeController();
      service.getBooks.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await controller.getBooks(10, USER, 0, 50);

      expect(service.getBooks).toHaveBeenCalledWith(10, USER, 0, 50, undefined, undefined);
    });

    it('rejects invalid page and size boundaries', async () => {
      const { controller, service } = makeController();

      await expectBadRequest(() => controller.getBooks(10, USER, -1, 50));
      await expectBadRequest(() => controller.getBooks(10, USER, 0, 0));
      await expectBadRequest(() => controller.getBooks(10, USER, 0, 101));
      expect(service.getBooks).not.toHaveBeenCalled();
    });

    it('rejects excessively deep pagination windows', async () => {
      const { controller, service } = makeController();

      await expectBadRequest(() => controller.getBooks(10, USER, 2_000_000, 100));
      expect(service.getBooks).not.toHaveBeenCalled();
    });

    it('accepts pagination at the maximum offset boundary', async () => {
      const { controller, service } = makeController();
      service.getBooks.mockResolvedValue({ items: [], total: 0, page: 500, size: 100 });

      await controller.getBooks(10, USER, 500, 100);

      expect(service.getBooks).toHaveBeenCalledWith(10, USER, 500, 100, undefined, undefined);
    });

    it('forwards collapseSeries and search query when present', async () => {
      const { controller, service } = makeController();
      service.getBooks.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await controller.getBooks(10, USER, 0, 50, true, 'dune');

      expect(service.getBooks).toHaveBeenCalledWith(10, USER, 0, 50, true, 'dune');
    });
  });

  it('forwards validated POST table queries to the collection service', async () => {
    const { controller, service } = makeController();
    const query: BookQuery = {
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'hobbit' }] },
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 50 },
      collapseSeries: true,
      q: 'tolkien',
    };

    await controller.queryBooks(10, query, USER);

    expect(service.queryBooks).toHaveBeenCalledWith(10, USER, query);
  });

  it('forwards jump bucket queries to the collection service', async () => {
    const { controller, service } = makeController();
    const query: BookQuery = {
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 50 },
    };

    await controller.queryJumpBuckets(10, query, USER);

    expect(service.queryJumpBuckets).toHaveBeenCalledWith(10, USER, query);
  });

  describe('mutation endpoints', () => {
    it('delegates create, update, remove, reorder, and membership mutations', async () => {
      const { controller, service } = makeController();

      await controller.create({ name: 'Favorites', icon: '⭐' } as any, USER);
      await controller.update(11, { name: 'Updated' } as any, USER);
      await controller.remove(11, USER);
      await controller.reorder({ order: [{ id: 1, displayOrder: 0 }] } as any, USER);
      await controller.addBooks(11, { bookIds: [7, 8] }, USER);
      await controller.removeBooks(11, { bookIds: [7] }, USER);
      await controller.findOne(11, USER);

      expect(service.create).toHaveBeenCalledWith({ name: 'Favorites', icon: '⭐' }, USER);
      expect(service.update).toHaveBeenCalledWith(11, { name: 'Updated' }, USER);
      expect(service.remove).toHaveBeenCalledWith(11, USER);
      expect(service.reorder).toHaveBeenCalledWith({ order: [{ id: 1, displayOrder: 0 }] }, USER);
      expect(service.addBooks).toHaveBeenCalledWith(11, { bookIds: [7, 8] }, USER);
      expect(service.removeBooks).toHaveBeenCalledWith(11, { bookIds: [7] }, USER);
      expect(service.findOne).toHaveBeenCalledWith(11, USER);
    });
  });

  it('exposes auditable metadata callbacks for resource ids and descriptions', () => {
    const createMeta = Reflect.getMetadata(AUDITABLE_KEY, CollectionController.prototype.create) as {
      description: (req: unknown, res: { name?: string }) => string;
    };
    const updateMeta = Reflect.getMetadata(AUDITABLE_KEY, CollectionController.prototype.update) as {
      getResourceId: (req: { params: { id: string } }) => number;
      description: (req: { params: { id: string } }) => string;
    };
    const removeMeta = Reflect.getMetadata(AUDITABLE_KEY, CollectionController.prototype.remove) as {
      getResourceId: (req: { params: { id: string } }) => number;
      description: (req: { params: { id: string } }) => string;
    };
    const addBooksMeta = Reflect.getMetadata(AUDITABLE_KEY, CollectionController.prototype.addBooks) as {
      getResourceId: (req: { params: { id: string } }) => number;
      description: (req: { params: { id: string }; body: { bookIds?: number[] } }) => string;
    };
    const removeBooksMeta = Reflect.getMetadata(AUDITABLE_KEY, CollectionController.prototype.removeBooks) as {
      getResourceId: (req: { params: { id: string } }) => number;
      description: (req: { params: { id: string }; body: { bookIds?: number[] } }) => string;
    };

    expect(createMeta.description({} as never, { name: 'Favorites' })).toBe("Created collection 'Favorites'");
    expect(updateMeta.getResourceId({ params: { id: '10' } })).toBe(10);
    expect(updateMeta.description({ params: { id: '10' } })).toBe('Updated collection #10');
    expect(removeMeta.getResourceId({ params: { id: '10' } })).toBe(10);
    expect(removeMeta.description({ params: { id: '10' } })).toBe('Deleted collection #10');
    expect(addBooksMeta.getResourceId({ params: { id: '10' } })).toBe(10);
    expect(addBooksMeta.description({ params: { id: '10' }, body: { bookIds: [1, 2] } })).toBe('Added 2 books to collection #10');
    expect(addBooksMeta.description({ params: { id: '10' }, body: {} })).toBe('Added 0 books to collection #10');
    expect(removeBooksMeta.getResourceId({ params: { id: '10' } })).toBe(10);
    expect(removeBooksMeta.description({ params: { id: '10' }, body: { bookIds: [1] } })).toBe('Removed 1 book from collection #10');
    expect(removeBooksMeta.description({ params: { id: '10' }, body: {} })).toBe('Removed 0 books from collection #10');
  });
});
