import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { KEY_READ_SAFE_KEY } from '../../common/decorators/api-key-policy.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { GenresController, TagsController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

function makeUser(): RequestUser {
  return {
    id: 11,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  return {
    findPage: vi.fn().mockResolvedValue('page'),
    findDetail: vi.fn().mockResolvedValue('detail'),
    findSimilar: vi.fn().mockResolvedValue('similar'),
    queryBooks: vi.fn().mockResolvedValue('books'),
    queryJumpBuckets: vi.fn().mockResolvedValue('buckets'),
  };
}

describe('taxonomy controllers', () => {
  it('serve genres and tags from their own paths', () => {
    expect(Reflect.getMetadata(PATH_METADATA, GenresController)).toBe('genres');
    expect(Reflect.getMetadata(PATH_METADATA, TagsController)).toBe('tags');
  });

  it('declare the service as their constructor dependency so Nest can inject it', () => {
    expect(Reflect.getMetadata('design:paramtypes', GenresController)).toEqual([TaxonomyService]);
    expect(Reflect.getMetadata('design:paramtypes', TagsController)).toEqual([TaxonomyService]);
  });

  it('inherit every route from the shared base', () => {
    const routes = (['findAll', 'findOne', 'findSimilar', 'queryBooks', 'queryJumpBuckets'] as const).map((name) => {
      const handler = TagsController.prototype[name];
      return [name, Reflect.getMetadata(METHOD_METADATA, handler), Reflect.getMetadata(PATH_METADATA, handler)];
    });

    expect(routes).toEqual([
      ['findAll', RequestMethod.GET, '/'],
      ['findOne', RequestMethod.GET, ':id'],
      ['findSimilar', RequestMethod.GET, ':id/similar'],
      ['queryBooks', RequestMethod.POST, ':id/books/query'],
      ['queryJumpBuckets', RequestMethod.POST, ':id/books/jump-buckets'],
    ]);
  });

  it('keeps the parameter bindings visible to the subclasses', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TagsController, 'queryBooks') as Record<string, unknown>;
    expect(Object.keys(args)).toHaveLength(4);
  });

  it('lets read-only API keys run the book queries, which only read', () => {
    expect(Reflect.getMetadata(KEY_READ_SAFE_KEY, GenresController.prototype.queryBooks)).toBe(true);
    expect(Reflect.getMetadata(KEY_READ_SAFE_KEY, GenresController.prototype.queryJumpBuckets)).toBe(true);
  });

  it('passes its own kind to every service call', async () => {
    const service = makeService();
    const genresController = new GenresController(service as never);
    const tagsController = new TagsController(service as never);
    const user = makeUser();
    const query = { pagination: { page: 0, size: 50 }, sort: [] } as never;

    await expect(genresController.findAll(user, { page: 0 } as never)).resolves.toBe('page');
    await expect(tagsController.findOne(4, user)).resolves.toBe('detail');
    await expect(tagsController.findSimilar(4, user)).resolves.toBe('similar');
    await expect(genresController.queryBooks(9, { libraryId: 2 }, query, user)).resolves.toBe('books');
    await expect(tagsController.queryJumpBuckets(9, {}, query, user)).resolves.toBe('buckets');

    expect(service.findPage).toHaveBeenCalledWith('genre', user, { page: 0 });
    expect(service.findDetail).toHaveBeenCalledWith('tag', 4, user);
    expect(service.findSimilar).toHaveBeenCalledWith('tag', 4, user);
    expect(service.queryBooks).toHaveBeenCalledWith('genre', 9, user, query, 2);
    expect(service.queryJumpBuckets).toHaveBeenCalledWith('tag', 9, user, query, undefined);
  });
});
