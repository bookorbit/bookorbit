import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { CollectionController } from './collection.controller';

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
    });
  });

  describe('getBooks', () => {
    it('delegates valid pagination queries to the service', async () => {
      const { controller, service } = makeController();
      service.getBooks.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await controller.getBooks(10, USER, 0, 50);

      expect(service.getBooks).toHaveBeenCalledWith(10, USER, 0, 50);
    });

    it('rejects invalid page and size boundaries', async () => {
      const { controller, service } = makeController();

      await expectBadRequest(() => controller.getBooks(10, USER, -1, 50));
      await expectBadRequest(() => controller.getBooks(10, USER, 0, 0));
      await expectBadRequest(() => controller.getBooks(10, USER, 0, 101));
      expect(service.getBooks).not.toHaveBeenCalled();
    });
  });
});
