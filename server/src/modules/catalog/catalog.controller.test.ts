import type { Mocked } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { SearchCatalogQueryDto } from './dto/search-catalog-query.dto';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function reqUser(): RequestUser {
  return { id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as RequestUser;
}

function makeController() {
  const service = {
    searchAuthors: vi.fn(),
    searchGenres: vi.fn(),
    searchTags: vi.fn(),
    searchNarrators: vi.fn(),
    searchPublishers: vi.fn(),
    searchSeries: vi.fn(),
    searchLanguages: vi.fn(),
    searchCollections: vi.fn(),
  } as unknown as Mocked<CatalogService>;

  return { controller: new CatalogController(service), service };
}

describe('CatalogController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates author queries to the catalog service', async () => {
    const { controller, service } = makeController();
    const expected = [{ name: 'Frank Herbert' }];
    service.searchAuthors.mockResolvedValue(expected);

    const result = await controller.searchAuthors(reqUser(), { q: 'Frank' });

    expect(service.searchAuthors).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Frank');
    expect(result).toEqual(expected);
  });

  it('uses dto default value when query string is omitted', async () => {
    const { controller, service } = makeController();
    const query = new SearchCatalogQueryDto();

    await controller.searchAuthors(reqUser(), query);

    expect(service.searchAuthors).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), '');
  });

  it('delegates genre queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchGenres(reqUser(), { q: 'Fantasy' });

    expect(service.searchGenres).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Fantasy');
  });

  it('delegates tag queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchTags(reqUser(), { q: 'Space Opera' });

    expect(service.searchTags).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Space Opera');
  });

  it('delegates narrator queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchNarrators(reqUser(), { q: 'Ray Porter' });

    expect(service.searchNarrators).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Ray Porter');
  });

  it('delegates publisher queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchPublishers(reqUser(), { q: 'Orbit' });

    expect(service.searchPublishers).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Orbit');
  });

  it('delegates series queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchSeries(reqUser(), { q: 'Expanse' });

    expect(service.searchSeries).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Expanse');
  });

  it('delegates language queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchLanguages(reqUser(), { q: 'English' });

    expect(service.searchLanguages).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'English');
  });

  it('passes current user id to collection search', async () => {
    const { controller, service } = makeController();
    const user = { id: 42, contentFilters: EMPTY_CONTENT_FILTER_RULES } as RequestUser;

    await controller.searchCollections(user, { q: 'Favorites' });

    expect(service.searchCollections).toHaveBeenCalledWith(42, 'Favorites');
  });
});
