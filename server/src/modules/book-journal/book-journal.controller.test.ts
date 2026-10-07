import 'reflect-metadata';

import { HttpStatus, ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookJournalController } from './book-journal.controller';

const CLIENT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';

const user: RequestUser = {
  id: 8,
  username: 'journal-user',
  name: 'Journal User',
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

describe('BookJournalController', () => {
  const service = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    purge: vi.fn(),
  };
  const controller = new BookJournalController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is mounted under the book it belongs to', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BookJournalController)).toBe('books/:bookId/journal');
  });

  it.each([
    ['list', RequestMethod.GET, '/', undefined],
    ['create', RequestMethod.POST, '/', undefined],
    ['update', RequestMethod.PATCH, ':clientId', undefined],
    ['trash', RequestMethod.DELETE, ':clientId', HttpStatus.NO_CONTENT],
    ['restore', RequestMethod.POST, ':clientId/restore', HttpStatus.OK],
    ['purge', RequestMethod.DELETE, ':clientId/permanent', HttpStatus.NO_CONTENT],
  ] as const)('declares %s as the expected route', (method, httpMethod, path, status) => {
    const handler = BookJournalController.prototype[method];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(httpMethod);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(status);
  });

  it.each(['update', 'trash', 'restore', 'purge'] as const)('validates the client id of %s as a UUID', (method) => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, BookJournalController, method) as Record<string, { data: string; pipes: unknown[] }>;
    const clientIdArg = Object.values(args).find((arg) => arg.data === 'clientId');
    expect(clientIdArg?.pipes.some((pipe) => pipe instanceof ParseUUIDPipe)).toBe(true);
  });

  it('defaults the list to active entries', async () => {
    service.list.mockResolvedValue([]);

    await controller.list(5, user, {});
    await controller.list(5, user, { status: 'trashed' });

    expect(service.list).toHaveBeenNthCalledWith(1, 5, user, 'active');
    expect(service.list).toHaveBeenNthCalledWith(2, 5, user, 'trashed');
  });

  it('delegates create, update, trash, restore and purge with the current user', async () => {
    const createDto = { clientId: CLIENT_ID, body: 'note' };
    await controller.create(5, createDto, user);
    await controller.update(5, CLIENT_ID, { body: 'edited' }, user);
    await controller.trash(5, CLIENT_ID, user);
    await controller.restore(5, CLIENT_ID, user);
    await controller.purge(5, CLIENT_ID, user);

    expect(service.create).toHaveBeenCalledWith(5, user, createDto);
    expect(service.update).toHaveBeenCalledWith(5, CLIENT_ID, user, { body: 'edited' });
    expect(service.trash).toHaveBeenCalledWith(5, CLIENT_ID, user);
    expect(service.restore).toHaveBeenCalledWith(5, CLIENT_ID, user);
    expect(service.purge).toHaveBeenCalledWith(5, CLIENT_ID, user);
  });
});
