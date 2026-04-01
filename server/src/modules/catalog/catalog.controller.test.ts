import type { Mocked } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { SearchCatalogQueryDto } from './dto/search-catalog-query.dto';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

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

    const result = await controller.searchAuthors({ q: 'Frank' });

    expect(service.searchAuthors).toHaveBeenCalledWith('Frank');
    expect(result).toEqual(expected);
  });

  it('uses dto default value when query string is omitted', async () => {
    const { controller, service } = makeController();
    const query = new SearchCatalogQueryDto();

    await controller.searchAuthors(query);

    expect(service.searchAuthors).toHaveBeenCalledWith('');
  });

  it('delegates genre queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchGenres({ q: 'Fantasy' });

    expect(service.searchGenres).toHaveBeenCalledWith('Fantasy');
  });

  it('delegates tag queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchTags({ q: 'Space Opera' });

    expect(service.searchTags).toHaveBeenCalledWith('Space Opera');
  });

  it('delegates narrator queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchNarrators({ q: 'Ray Porter' });

    expect(service.searchNarrators).toHaveBeenCalledWith('Ray Porter');
  });

  it('delegates publisher queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchPublishers({ q: 'Orbit' });

    expect(service.searchPublishers).toHaveBeenCalledWith('Orbit');
  });

  it('delegates series queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchSeries({ q: 'Expanse' });

    expect(service.searchSeries).toHaveBeenCalledWith('Expanse');
  });

  it('delegates language queries to the catalog service', async () => {
    const { controller, service } = makeController();

    await controller.searchLanguages({ q: 'English' });

    expect(service.searchLanguages).toHaveBeenCalledWith('English');
  });

  it('passes current user id to collection search', async () => {
    const { controller, service } = makeController();
    const user = { id: 42 } as RequestUser;

    await controller.searchCollections(user, { q: 'Favorites' });

    expect(service.searchCollections).toHaveBeenCalledWith(42, 'Favorites');
  });
});
