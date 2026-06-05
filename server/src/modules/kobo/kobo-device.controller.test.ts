import { KoboDeviceController } from './kobo-device.controller';

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
  };
}

describe('KoboDeviceController', () => {
  const thumbnailService = {
    serveThumbnail: vi.fn(),
  };
  const downloadService = {
    streamBook: vi.fn(),
  };
  const proxyService = {
    forward: vi.fn(),
  };
  const bookIdentityService = {
    resolveBookIdByEntitlementId: vi.fn(),
    resolveBookIdByCoverImageId: vi.fn(),
  };

  const controller = new KoboDeviceController(
    thumbnailService as never,
    downloadService as never,
    proxyService as never,
    bookIdentityService as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    bookIdentityService.resolveBookIdByEntitlementId.mockImplementation((_userId: number, id: string) => (/^\d+$/.test(id) ? Number(id) : null));
    bookIdentityService.resolveBookIdByCoverImageId.mockImplementation((_userId: number, id: string) => {
      const match = /^(\d+)(?:-\d+)?$/.exec(id);
      return match ? Number(match[1]) : null;
    });
  });

  it('resolves legacy compound CoverImageId format (bookId-timestamp) for thumbnails', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/42-1778450221186/thumbnail/355/530/80/False/image.jpg' };
    const reply = makeReply();

    await controller.thumbnailFull(
      '42-1778450221186',
      undefined,
      { id: 5 } as never,
      { deviceToken: 'token' } as never,
      req as never,
      reply as never,
    );
    await controller.thumbnailSimple(
      '42-1778450221186',
      undefined,
      { id: 5 } as never,
      { deviceToken: 'token' } as never,
      req as never,
      reply as never,
    );

    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(1, 5, 42, undefined, reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(2, 5, 42, undefined, reply);
  });

  it('serves thumbnail for valid book ids across all thumbnail endpoints', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/12/thumbnail/300/300/false/image.jpg' };
    const reply = makeReply();

    await controller.thumbnailSimple('12', undefined, { id: 5 } as never, { deviceToken: 'token' } as never, req as never, reply as never);
    await controller.thumbnailFull('12', '"etag"', { id: 5 } as never, { deviceToken: 'token' } as never, req as never, reply as never);
    await controller.thumbnailVersioned('12', undefined, { id: 5 } as never, { deviceToken: 'token' } as never, req as never, reply as never);

    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(1, 5, 12, undefined, reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(2, 5, 12, '"etag"', reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(3, 5, 12, undefined, reply);
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('proxies thumbnail and download requests for non-numeric ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/not-a-number/download' };
    const reply = makeReply();
    proxyService.forward.mockResolvedValue(undefined);
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(null);
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(null);

    await controller.thumbnailSimple('abc', undefined, { id: 9 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);
    await controller.download('abc', { id: 9 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledTimes(2);
    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'dev-token');
    expect(downloadService.streamBook).not.toHaveBeenCalled();
  });

  it('streams downloads for valid numeric ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/9/download' };
    const reply = makeReply();

    await controller.download('9', { id: 11 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);

    expect(downloadService.streamBook).toHaveBeenCalledWith(11, 9, reply);
  });

  it('streams downloads and thumbnails for resolved Kobo UUID ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/kobo-id/download' };
    const reply = makeReply();
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(420);
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(420);

    await controller.download('kobo-entitlement-id', { id: 11 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);
    await controller.thumbnailSimple(
      'kobo-cover-id',
      undefined,
      { id: 11 } as never,
      { deviceToken: 'dev-token' } as never,
      req as never,
      reply as never,
    );

    expect(downloadService.streamBook).toHaveBeenCalledWith(11, 420, reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenCalledWith(11, 420, undefined, reply);
  });

  it('returns static payload endpoints and analytics keys', () => {
    expect(controller.affiliate()).toEqual({});
    expect(controller.remainingBookSeries()).toEqual({ TotalResultCount: 0, SearchResults: [] });
    expect(controller.productNextRead()).toEqual([]);
    expect(controller.analyticsEvent()).toEqual({});
    expect(controller.getTests()).toEqual({ Result: 'Success', TestKey: expect.any(String) });
  });

  it('forwards unmatched routes through proxy service', async () => {
    const req = { method: 'PUT', url: '/api/v1/kobo/token/v1/unknown' };
    const reply = makeReply();

    await controller.proxy({ deviceToken: 'tok-123' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'tok-123');
  });
});
