import { GUARDS_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogController } from './koreader-catalog.controller';

function makeController() {
  const catalogService = {
    getRoot: vi.fn().mockReturnValue({ sections: [] }),
    getDashboard: vi.fn().mockResolvedValue({ generatedAt: '2026-06-26T00:00:00.000Z', sections: [], continueReading: [] }),
    getSectionEntries: vi.fn().mockResolvedValue({ section: 'libraries', items: [] }),
    getBooksPage: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, size: 20, hasNext: false, hasPrevious: false, nextUrl: null, previousUrl: null }),
    getBookDetail: vi.fn().mockResolvedValue({ id: 10 }),
    getDashboardSection: vi.fn().mockResolvedValue({ section: { type: 'want-to-read', smartScopeId: null, books: [] } }),
    getBulkManifest: vi.fn().mockResolvedValue({ items: [], hasNext: false, nextCursor: null, manifestVersion: 'lib-v1', restartRequired: false }),
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
    const bookDetailQuery = { deviceId: 'device-1' };

    expect(controller.root()).toEqual({ sections: [] });
    await expect(controller.dashboard(user, {})).resolves.toEqual(expect.objectContaining({ generatedAt: '2026-06-26T00:00:00.000Z' }));
    await expect(controller.sections(user, 'libraries', sectionQuery)).resolves.toEqual({ section: 'libraries', items: [] });
    await expect(controller.books(user, query)).resolves.toEqual(expect.objectContaining({ total: 0 }));
    await expect(controller.bookDetail(user, 10, bookDetailQuery)).resolves.toEqual({ id: 10 });
    const manifestQuery = { deviceId: 'device-1', size: 100 } as never;
    await expect(controller.manifest(user, manifestQuery)).resolves.toEqual(expect.objectContaining({ manifestVersion: 'lib-v1' }));
    await expect(controller.setReadStatus(user, 10, { status: 'reading' } as never)).resolves.toEqual({ readStatus: 'reading' });
    await expect(controller.setRating(user, 10, { rating: 4 } as never)).resolves.toEqual({ rating: 4 });
    await controller.thumbnail(user, 10, reply, '"etag"');
    await controller.download(user, 100, reply);

    expect(catalogService.getDashboard).toHaveBeenCalledWith(user, undefined);
    expect(catalogService.getSectionEntries).toHaveBeenCalledWith(user, 'libraries', sectionQuery);
    expect(catalogService.getBooksPage).toHaveBeenCalledWith(user, query);
    expect(catalogService.getBookDetail).toHaveBeenCalledWith(user, 10, 'device-1');
    expect(catalogService.getBulkManifest).toHaveBeenCalledWith(user, manifestQuery);
    expect(catalogService.setReadStatus).toHaveBeenCalledWith(user, 10, 'reading');
    expect(catalogService.setRating).toHaveBeenCalledWith(user, 10, 4);
    expect(catalogService.streamThumbnail).toHaveBeenCalledWith(user, 10, reply, '"etag"');
    expect(catalogService.streamFile).toHaveBeenCalledWith(user, 100, reply);
  });

  it('passes a named dashboard section through and omits smartScopeId unless it is set', async () => {
    const { controller, catalogService } = makeController();
    const user = { id: 7 } as never;

    await controller.dashboard(user, { section: 'want-to-read' });
    expect(catalogService.getDashboard).toHaveBeenCalledWith(user, { type: 'want-to-read' });

    await controller.dashboard(user, { section: 'smart-scope', smartScopeId: 3 });
    expect(catalogService.getDashboard).toHaveBeenCalledWith(user, { type: 'smart-scope', smartScopeId: 3 });
  });

  it('forwards the single-section refresh route', async () => {
    const { controller, catalogService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.dashboardSection(user, 'want-to-read', {})).resolves.toEqual({
      section: { type: 'want-to-read', smartScopeId: null, books: [] },
    });
    expect(catalogService.getDashboardSection).toHaveBeenCalledWith(user, { type: 'want-to-read' });

    await controller.dashboardSection(user, 'smart-scope', { smartScopeId: 5 });
    expect(catalogService.getDashboardSection).toHaveBeenCalledWith(user, { type: 'smart-scope', smartScopeId: 5 });
  });
});
