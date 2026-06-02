import 'reflect-metadata';

import type { RequestUser } from '../../common/types/request-user';
import { SeriesController } from './series.controller';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 11,
    username: 'series-reader',
    name: 'Series Reader',
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

function makeController() {
  const seriesService = {
    findAll: vi.fn(),
    findBooks: vi.fn(),
  };

  const controller = new SeriesController(seriesService as any);
  return { controller, seriesService };
}

describe('SeriesController', () => {
  it('findAll delegates to service', async () => {
    const { controller, seriesService } = makeController();
    const user = makeUser();
    const dto = { page: 0, size: 50 };
    const expected = { items: [], total: 0, page: 0, size: 50 };
    seriesService.findAll.mockResolvedValue(expected);

    const result = await controller.findAll(user, dto as any);

    expect(seriesService.findAll).toHaveBeenCalledWith(user, dto);
    expect(result).toBe(expected);
  });

  it('findBooks delegates to service with numeric series id', async () => {
    const { controller, seriesService } = makeController();
    const user = makeUser();
    const dto = { page: 0, size: 50 };
    const expected = {
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { id: 42, name: 'Harry Potter', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    };
    seriesService.findBooks.mockResolvedValue(expected);

    const result = await controller.findBooks(user, 42, dto as any);

    expect(seriesService.findBooks).toHaveBeenCalledWith(user, 42, dto);
    expect(result).toBe(expected);
  });
});
