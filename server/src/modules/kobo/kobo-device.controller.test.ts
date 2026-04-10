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

  const controller = new KoboDeviceController(thumbnailService as never, downloadService as never, proxyService as never);

  beforeEach(() => {
    vi.clearAllMocks();
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
