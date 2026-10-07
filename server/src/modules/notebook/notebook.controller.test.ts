import 'reflect-metadata';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { NotebookController } from './notebook.controller';

const user: RequestUser = {
  id: 8,
  username: 'reader',
  name: 'Reader',
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

describe('NotebookController', () => {
  const service = {
    entries: vi.fn(),
    overview: vi.fn(),
    books: vi.fn(),
    review: vi.fn(),
    onThisDay: vi.fn(),
    trash: vi.fn(),
  };
  const controller = new NotebookController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is mounted at notebook', () => {
    expect(Reflect.getMetadata(PATH_METADATA, NotebookController)).toBe('notebook');
  });

  it.each([
    ['entries', 'entries'],
    ['overview', 'overview'],
    ['books', 'books'],
    ['review', 'review'],
    ['onThisDay', 'on-this-day'],
    ['trash', 'trash'],
  ] as const)('declares %s as GET %s', (method, path) => {
    const handler = NotebookController.prototype[method];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('delegates every route with the current user and the query', async () => {
    await controller.entries(user, { sort: 'oldest' });
    await controller.overview(user, { starred: true });
    await controller.books(user, { q: 'dune' });
    await controller.review(user, { seed: 1 });
    await controller.onThisDay(user, { date: '2026-10-04' });
    await controller.trash(user, { limit: 5 });

    expect(service.entries).toHaveBeenCalledWith(user, { sort: 'oldest' });
    expect(service.overview).toHaveBeenCalledWith(user, { starred: true });
    expect(service.books).toHaveBeenCalledWith(user, { q: 'dune' });
    expect(service.review).toHaveBeenCalledWith(user, { seed: 1 });
    expect(service.onThisDay).toHaveBeenCalledWith(user, { date: '2026-10-04' });
    expect(service.trash).toHaveBeenCalledWith(user, { limit: 5 });
  });
});
