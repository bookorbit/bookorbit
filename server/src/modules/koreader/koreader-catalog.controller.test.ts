import { GUARDS_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogController } from './koreader-catalog.controller';

function makeController() {
  const catalogService = {
    getRoot: vi.fn().mockReturnValue({ sections: [] }),
    getSectionEntries: vi.fn().mockResolvedValue({ section: 'libraries', items: [] }),
    getBooksPage: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, size: 20, hasNext: false, hasPrevious: false, nextUrl: null, previousUrl: null }),
    getBookDetail: vi.fn().mockResolvedValue({ id: 10 }),
    setReadStatus: vi.fn().mockResolvedValue({ readStatus: 'reading' }),
    setRating: vi.fn().mockResolvedValue({ rating: 4 }),
    streamThumbnail: vi.fn().mockResolvedValue(undefined),
    streamFile: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new KoreaderCatalogController(catalogService as never), catalogService };
}

describe('KoreaderCatalogController', () => {
  it('is public only for the global JWT guard and uses the KOReader auth guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderCatalogController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, KoreaderCatalogController)).toEqual([KoreaderAuthGuard]);
  });

  it('forwards catalog routes to the service', async () => {
    const { controller, catalogService } = makeController();
    const user = { id: 7 } as never;
    const reply = { send: vi.fn() } as never;
    const query = { page: 1, size: 20 } as never;
    const sectionQuery = { page: 1 } as never;

    expect(controller.root()).toEqual({ sections: [] });
    await expect(controller.sections(user, 'libraries', sectionQuery)).resolves.toEqual({ section: 'libraries', items: [] });
    await expect(controller.books(user, query)).resolves.toEqual(expect.objectContaining({ total: 0 }));
    await expect(controller.bookDetail(user, 10)).resolves.toEqual({ id: 10 });
    await expect(controller.setReadStatus(user, 10, { status: 'reading' } as never)).resolves.toEqual({ readStatus: 'reading' });
    await expect(controller.setRating(user, 10, { rating: 4 } as never)).resolves.toEqual({ rating: 4 });
    await controller.thumbnail(user, 10, reply, '"etag"');
    await controller.download(user, 100, reply);

    expect(catalogService.getSectionEntries).toHaveBeenCalledWith(user, 'libraries', sectionQuery);
    expect(catalogService.getBooksPage).toHaveBeenCalledWith(user, query);
    expect(catalogService.getBookDetail).toHaveBeenCalledWith(user, 10);
    expect(catalogService.setReadStatus).toHaveBeenCalledWith(user, 10, 'reading');
    expect(catalogService.setRating).toHaveBeenCalledWith(user, 10, 4);
    expect(catalogService.streamThumbnail).toHaveBeenCalledWith(user, 10, reply, '"etag"');
    expect(catalogService.streamFile).toHaveBeenCalledWith(user, 100, reply);
  });
});
