import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { KoboDeviceController } from './kobo-device.controller';

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
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
  const analyticsService = {
    ingest: vi.fn(),
  };
  const bookIdentityService = {
    resolveBookIdByEntitlementId: vi.fn(),
    resolveBookIdByCoverImageId: vi.fn(),
  };
  const historyService = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    countsForBook: vi.fn(),
  };

  const controller = new KoboDeviceController(
    thumbnailService as never,
    downloadService as never,
    proxyService as never,
    analyticsService as never,
    bookIdentityService as never,
    historyService as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    historyService.countsForBook.mockImplementation((_userId: number, bookId: number, counts: Record<string, unknown>) => ({
      ...counts,
      bookId,
      bookTitle: 'Dune',
    }));
    bookIdentityService.resolveBookIdByEntitlementId.mockImplementation((_userId: number, id: string) => (/^\d+$/.test(id) ? Number(id) : null));
    bookIdentityService.resolveBookIdByCoverImageId.mockImplementation((_userId: number, id: string) => {
      const match = /^(\d+)(?:-\d+)?$/.exec(id);
      return match ? Number(match[1]) : null;
    });
  });

  it('resolves legacy compound CoverImageId format (bookId-timestamp) for thumbnails', async () => {
    const reply = makeReply();

    await controller.thumbnailFull('42-1778450221186', '355', '530', '80', 'False', undefined, { id: 5 } as never, reply as never);
    await controller.thumbnailSimple('42-1778450221186', '355', '530', undefined, { id: 5 } as never, reply as never);

    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(1, 5, 42, undefined, reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(2, 5, 42, undefined, reply);
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('serves thumbnail for valid book ids across all thumbnail endpoints', async () => {
    const reply = makeReply();

    await controller.thumbnailSimple('12', '300', '300', undefined, { id: 5 } as never, reply as never);
    await controller.thumbnailFull('12', '300', '300', '80', 'false', '"etag"', { id: 5 } as never, reply as never);
    await controller.thumbnailVersioned('12', '300', '300', undefined, { id: 5 } as never, reply as never);

    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(1, 5, 12, undefined, reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(2, 5, 12, '"etag"', reply);
    expect(thumbnailService.serveThumbnail).toHaveBeenNthCalledWith(3, 5, 12, undefined, reply);
    expect(proxyService.forward).not.toHaveBeenCalled();
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('redirects unresolved cover ids to the Kobo image CDN instead of storeapi', async () => {
    const reply = makeReply();
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(null);

    await controller.thumbnailFull(
      '4e0b1d1a-9d3e-4a6f-9c1a-1f2b3c4d5e6f',
      '355',
      '530',
      '80',
      'False',
      undefined,
      { id: 9 } as never,
      reply as never,
    );

    expect(reply.redirect).toHaveBeenCalledWith(
      'https://cdn.kobo.com/book-images/4e0b1d1a-9d3e-4a6f-9c1a-1f2b3c4d5e6f/355/530/80/False/image.jpg',
      302,
    );
    expect(thumbnailService.serveThumbnail).not.toHaveBeenCalled();
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('redirects unresolved cover ids on the greyscale-free template without a quality segment', async () => {
    const reply = makeReply();
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(null);

    await controller.thumbnailSimple('store-cover', '355', '530', undefined, { id: 9 } as never, reply as never);

    expect(reply.redirect).toHaveBeenCalledWith('https://cdn.kobo.com/book-images/store-cover/355/530/false/image.jpg', 302);
  });

  it('404s rather than redirecting when a cover request cannot be mapped to a CDN path', async () => {
    const reply = makeReply();
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(null);

    await expect(controller.thumbnailSimple('  ', '355', '530', undefined, { id: 9 } as never, reply as never)).rejects.toThrow('No cover image');
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('proxies download requests for non-numeric ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/not-a-number/download' };
    const reply = makeReply();
    proxyService.forward.mockResolvedValue(undefined);
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(null);

    await controller.download('abc', { id: 9 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledTimes(1);
    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'dev-token');
    expect(downloadService.streamBook).not.toHaveBeenCalled();
  });

  it('streams downloads for valid numeric ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/9/download', headers: {} };
    const reply = makeReply();

    await controller.download('9', { id: 11 } as never, { deviceId: 4, deviceToken: 'dev-token' } as never, req as never, reply as never);

    expect(downloadService.streamBook).toHaveBeenCalledWith(11, 9, reply, { rangeHeader: undefined, ifRangeHeader: undefined });
    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 11,
        deviceId: 4,
        event: 'book_download',
        counts: { downloads: 1, bookId: 9, bookTitle: 'Dune' },
      }),
    );
    expect(historyService.countsForBook).toHaveBeenCalledWith(11, 9, { downloads: 1 });
  });

  it('records failed downloads before rethrowing', async () => {
    const error = new Error('file missing');
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/9/download', headers: {} };
    const reply = makeReply();
    downloadService.streamBook.mockRejectedValueOnce(error);

    await expect(
      controller.download('9', { id: 11 } as never, { deviceId: 4, deviceToken: 'dev-token' } as never, req as never, reply as never),
    ).rejects.toThrow('file missing');

    expect(historyService.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 11, deviceId: 4, event: 'book_download' }), error);
  });

  it('streams downloads and thumbnails for resolved Kobo UUID ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/books/kobo-id/download', headers: {} };
    const reply = makeReply();
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(420);
    bookIdentityService.resolveBookIdByCoverImageId.mockResolvedValue(420);

    await controller.download('kobo-entitlement-id', { id: 11 } as never, { deviceToken: 'dev-token' } as never, req as never, reply as never);
    await controller.thumbnailSimple('kobo-cover-id', '355', '530', undefined, { id: 11 } as never, reply as never);

    expect(downloadService.streamBook).toHaveBeenCalledWith(11, 420, reply, { rangeHeader: undefined, ifRangeHeader: undefined });
    expect(thumbnailService.serveThumbnail).toHaveBeenCalledWith(11, 420, undefined, reply);
  });

  it('forwards Range and If-Range headers to the download service', async () => {
    const req = {
      method: 'GET',
      url: '/api/v1/kobo/token/v1/books/9/download',
      headers: { range: 'bytes=1024-', 'if-range': '"3e8-18b8"' },
    };
    const reply = makeReply();

    await controller.download('9', { id: 11 } as never, { deviceId: 4, deviceToken: 'dev-token' } as never, req as never, reply as never);

    expect(downloadService.streamBook).toHaveBeenCalledWith(11, 9, reply, { rangeHeader: 'bytes=1024-', ifRangeHeader: '"3e8-18b8"' });
  });

  it('returns static payload endpoints and ingests analytics events', async () => {
    expect(controller.affiliate()).toEqual({});
    expect(controller.remainingBookSeries()).toEqual({ TotalResultCount: 0, SearchResults: [] });
    expect(controller.productNextRead()).toEqual([]);
    analyticsService.ingest.mockResolvedValue(undefined);
    await expect(controller.analyticsEvent({ Events: [] }, { id: 3 } as never, { deviceToken: 't' } as never)).resolves.toEqual({});
    expect(analyticsService.ingest).toHaveBeenCalledWith({ Events: [] }, { id: 3 }, { deviceToken: 't' });
  });

  it('registers GET and POST handlers for the advertised gettests endpoint', () => {
    expect(Reflect.getMetadata(PATH_METADATA, KoboDeviceController.prototype.getTests)).toBe('v1/analytics/gettests');
    expect(Reflect.getMetadata(METHOD_METADATA, KoboDeviceController.prototype.getTests)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, KoboDeviceController.prototype.postGetTests)).toBe('v1/analytics/gettests');
    expect(Reflect.getMetadata(METHOD_METADATA, KoboDeviceController.prototype.postGetTests)).toBe(RequestMethod.POST);
  });

  it.each([
    ['GET', () => controller.getTests()],
    ['POST', () => controller.postGetTests()],
  ])('returns a Kobo-compatible success payload for %s gettests requests', (_method, request) => {
    const response = request();

    expect(response).toEqual({
      Result: 'Success',
      TestKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      Tests: {},
    });
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('returns {} when analytics ingest throws', async () => {
    analyticsService.ingest.mockRejectedValue(new Error('db down'));

    await expect(
      controller.analyticsEvent(
        { Events: [{ Id: '1', EventType: 'LeaveContent', Timestamp: '2026-06-01T00:00:00Z' }] },
        { id: 1 } as never,
        {
          deviceToken: 't',
        } as never,
      ),
    ).resolves.toEqual({});
  });

  it('returns {} when analytics ingest throws a non-Error value', async () => {
    analyticsService.ingest.mockRejectedValue('db down');

    await expect(controller.analyticsEvent({ Events: [] }, { id: 1 } as never, { deviceToken: 't' } as never)).resolves.toEqual({});
  });

  it('forwards unmatched routes through proxy service', async () => {
    const req = { method: 'PUT', url: '/api/v1/kobo/token/v1/unknown' };
    const reply = makeReply();

    await controller.proxy({ deviceToken: 'tok-123' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'tok-123');
  });
});
