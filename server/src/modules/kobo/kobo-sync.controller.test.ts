import { HttpStatus } from '@nestjs/common';

import { KoboSyncController } from './kobo-sync.controller';

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('KoboSyncController', () => {
  const settingsService = {
    getSettings: vi.fn(),
  };
  const syncService = {
    getDelta: vi.fn(),
    getBookMetadata: vi.fn(),
    removeBookFromSync: vi.fn(),
  };
  const readingStateService = {
    getRawState: vi.fn(),
    upsertState: vi.fn(),
  };
  const proxyService = {
    forward: vi.fn(),
  };
  const bookIdentityService = {
    resolveBookIdByEntitlementId: vi.fn(),
  };
  const historyService = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    countsForBook: vi.fn(),
  };

  const controller = new KoboSyncController(
    settingsService as never,
    syncService as never,
    readingStateService as never,
    proxyService as never,
    bookIdentityService as never,
    historyService as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    bookIdentityService.resolveBookIdByEntitlementId.mockImplementation((_userId: number, id: string) => (/^\d+$/.test(id) ? Number(id) : null));
    historyService.countsForBook.mockImplementation((_userId: number, bookId: number, counts: Record<string, unknown>) => ({
      ...counts,
      bookId,
      bookTitle: 'Dune',
    }));
  });

  it('initialization builds resource URLs from forwarded headers', () => {
    const req = {
      headers: {
        'x-forwarded-host': 'reader.example.com',
        'x-forwarded-proto': 'https',
        host: 'localhost:3000',
      },
      protocol: 'http',
      hostname: 'localhost',
      socket: { localPort: 3000 },
    };

    const payload = controller.initialization({ deviceToken: 'device-token' } as never, req as never);
    const resources = payload.Resources as Record<string, string>;

    expect(resources.image_host).toBe('https://reader.example.com');
    expect(resources.image_url_template).toContain('/api/v1/kobo/device-token/v1/books/{ImageId}/thumbnail/{Width}/{Height}/false/image.jpg');
    expect(resources.library_sync).toBe('https://reader.example.com/api/v1/kobo/device-token/v1/library/sync');
    expect(resources.get_tests_request).toBe('https://reader.example.com/api/v1/kobo/device-token/v1/analytics/gettests');
    expect(resources.post_analytics_event).toBe('https://reader.example.com/api/v1/kobo/device-token/v1/analytics/event');
  });

  it('initialization appends x-forwarded-port when host has no port (Vite dev proxy scenario)', () => {
    const req = {
      headers: {
        'x-forwarded-host': '192.168.8.134',
        'x-forwarded-port': '5173',
        'x-forwarded-proto': 'http',
        host: '192.168.8.134',
      },
      protocol: 'http',
      hostname: '192.168.8.134',
      socket: { localPort: 3000 },
    };

    const payload = controller.initialization({ deviceToken: 'dev' } as never, req as never);
    const resources = payload.Resources as Record<string, string>;

    expect(resources.image_host).toBe('http://192.168.8.134:5173');
    expect(resources.library_sync).toBe('http://192.168.8.134:5173/api/v1/kobo/dev/v1/library/sync');
  });

  it('initialization does not append x-forwarded-port when it is the default for the scheme', () => {
    const httpDefault = {
      headers: { 'x-forwarded-host': 'example.com', 'x-forwarded-port': '80', 'x-forwarded-proto': 'http' },
      protocol: 'http',
      hostname: 'example.com',
      socket: { localPort: 80 },
    };
    const httpsDefault = {
      headers: { 'x-forwarded-host': 'example.com', 'x-forwarded-port': '443', 'x-forwarded-proto': 'https' },
      protocol: 'https',
      hostname: 'example.com',
      socket: { localPort: 443 },
    };

    const r1 = controller.initialization({ deviceToken: 'x' } as never, httpDefault as never);
    const r2 = controller.initialization({ deviceToken: 'x' } as never, httpsDefault as never);

    expect((r1.Resources as Record<string, string>).image_host).toBe('http://example.com');
    expect((r2.Resources as Record<string, string>).image_host).toBe('https://example.com');
  });

  it('initialization uses custom x-forwarded-port for non-standard HTTPS', () => {
    const req = {
      headers: { 'x-forwarded-host': 'myapp.com', 'x-forwarded-port': '8443', 'x-forwarded-proto': 'https' },
      protocol: 'https',
      hostname: 'myapp.com',
      socket: { localPort: 3000 },
    };

    const payload = controller.initialization({ deviceToken: 'x' } as never, req as never);

    expect((payload.Resources as Record<string, string>).image_host).toBe('https://myapp.com:8443');
  });

  it('initialization ignores x-forwarded-port when host already contains a port', () => {
    const req = {
      headers: { 'x-forwarded-host': 'myapp.com:8080', 'x-forwarded-port': '9090', 'x-forwarded-proto': 'https' },
      protocol: 'https',
      hostname: 'myapp.com',
      socket: { localPort: 3000 },
    };

    const payload = controller.initialization({ deviceToken: 'x' } as never, req as never);

    expect((payload.Resources as Record<string, string>).image_host).toBe('https://myapp.com:8080');
  });

  it('initialization takes first value when x-forwarded-host is an array', () => {
    const req = {
      headers: { 'x-forwarded-host': ['primary.example.com', 'fallback.example.com'], 'x-forwarded-proto': 'https' },
      protocol: 'http',
      hostname: 'localhost',
      socket: { localPort: 3000 },
    };

    const payload = controller.initialization({ deviceToken: 'x' } as never, req as never);

    expect((payload.Resources as Record<string, string>).image_host).toBe('https://primary.example.com');
  });

  it('initialization appends local port when request host has no explicit port', () => {
    const req = {
      headers: { host: '127.0.0.1' },
      protocol: 'http',
      hostname: '127.0.0.1',
      socket: { localPort: 8080 },
    };

    const payload = controller.initialization({ deviceToken: 'abc' } as never, req as never);

    expect((payload.Resources as Record<string, string>).image_host).toBe('http://127.0.0.1:8080');
  });

  it('initialization does not append local port when it is the HTTP default', () => {
    const req = {
      headers: { host: 'example.com' },
      protocol: 'http',
      hostname: 'example.com',
      socket: { localPort: 80 },
    };

    const payload = controller.initialization({ deviceToken: 'abc' } as never, req as never);

    expect((payload.Resources as Record<string, string>).image_host).toBe('http://example.com');
  });

  it('librarySync sets response headers and sends entitlement payload', async () => {
    syncService.getDelta.mockResolvedValue({
      entitlements: [{ NewEntitlement: { BookEntitlement: { Id: '12' } } }],
      hasMore: true,
      syncToken: 'SYNC-2',
    });
    const req = {
      headers: { host: 'kobo.local' },
      protocol: 'http',
      hostname: 'kobo.local',
      socket: { localPort: 3000 },
    };
    const reply = makeReply();

    await controller.librarySync({ deviceId: 9, deviceToken: 'token-9' } as never, { id: 21 } as never, req as never, reply as never);

    expect(settingsService.getSettings).not.toHaveBeenCalled();
    expect(syncService.getDelta).toHaveBeenCalledWith(21, 9, 'token-9', 'http://kobo.local:3000');
    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 21,
        deviceId: 9,
        event: 'library_sync',
        counts: { entitlements: 1, hasMore: true },
      }),
    );
    expect(reply.header).toHaveBeenCalledWith('x-kobo-sync', 'continue');
    expect(reply.header).toHaveBeenCalledWith('x-kobo-synctoken', 'SYNC-2');
    expect(reply.send).toHaveBeenCalledWith([{ NewEntitlement: { BookEntitlement: { Id: '12' } } }]);
  });

  it('records failed library sync operations before rethrowing', async () => {
    const error = new Error('snapshot failed');
    syncService.getDelta.mockRejectedValue(error);
    const req = {
      headers: { host: 'kobo.local' },
      protocol: 'http',
      hostname: 'kobo.local',
      socket: { localPort: 3000 },
    };
    const reply = makeReply();

    await expect(
      controller.librarySync({ deviceId: 10, deviceToken: 'token-10' } as never, { id: 22 } as never, req as never, reply as never),
    ).rejects.toThrow('snapshot failed');

    expect(historyService.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 22, deviceId: 10, event: 'library_sync' }), error);
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('acknowledges delete-items requests for synced BookOrbit collection tags', async () => {
    const req = { method: 'POST', url: '/api/v1/kobo/token/v1/library/tags/col-1/items/delete' };
    const reply = makeReply();

    await controller.deleteTagItems('col-1', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('proxies delete-items requests for non-BookOrbit Kobo tags', async () => {
    const req = { method: 'POST', url: '/api/v1/kobo/token/v1/library/tags/kobo-tag/items/delete' };
    const reply = makeReply();

    await controller.deleteTagItems('kobo-tag', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'token-1');
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('acknowledges add-items requests for synced BookOrbit collection tags', async () => {
    const req = { method: 'POST', url: '/api/v1/kobo/token/v1/library/tags/col-1/items' };
    const reply = makeReply();

    await controller.addTagItems('col-1', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('proxies add-items requests for non-BookOrbit Kobo tags', async () => {
    const req = { method: 'POST', url: '/api/v1/kobo/token/v1/library/tags/kobo-tag/items' };
    const reply = makeReply();

    await controller.addTagItems('kobo-tag', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'token-1');
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('acknowledges delete-tag requests for synced BookOrbit collection tags', async () => {
    const req = { method: 'DELETE', url: '/api/v1/kobo/token/v1/library/tags/col-1' };
    const reply = makeReply();

    await controller.deleteTag('col-1', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('proxies delete-tag requests for non-BookOrbit Kobo tags', async () => {
    const req = { method: 'DELETE', url: '/api/v1/kobo/token/v1/library/tags/kobo-tag' };
    const reply = makeReply();

    await controller.deleteTag('kobo-tag', { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'token-1');
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('does not proxy delete-tag requests for BookOrbit tag ids using a different device token', async () => {
    const req = { method: 'DELETE', url: '/api/v1/kobo/other-token/v1/library/tags/col-42' };
    const reply = makeReply();

    await controller.deleteTag('col-42', { deviceToken: 'other-token' } as never, req as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
    expect(proxyService.forward).not.toHaveBeenCalled();
  });

  it('proxies metadata/state/delete for non-numeric book ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/library/abc/metadata' };
    const reply = makeReply();
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(null);

    await controller.getBookMetadata('abc', { id: 1 } as never, { deviceToken: 'token-1' } as never, req as never, reply as never);
    await controller.deleteFromLibrary('abc', { id: 1 } as never, { deviceToken: 'token-1' } as never, req as never, reply as never);
    await controller.getReadingState('abc', { id: 1 } as never, { deviceToken: 'token-1' } as never, req as never, reply as never);
    await controller.updateReadingState('abc', {}, { id: 1 } as never, { deviceToken: 'token-1' } as never, req as never, reply as never);

    expect(proxyService.forward).toHaveBeenCalledTimes(4);
    expect(proxyService.forward).toHaveBeenNthCalledWith(1, req, reply, 'token-1');
  });

  it('serves metadata, delete ack, and reading-state payloads for valid ids', async () => {
    const req = { headers: { host: 'localhost:3000' }, protocol: 'http', hostname: 'localhost', socket: { localPort: 3000 } };
    const reply = makeReply();
    syncService.getBookMetadata.mockResolvedValue([{ Title: 'Dune' }]);
    readingStateService.getRawState.mockResolvedValueOnce(null).mockResolvedValueOnce({ EntitlementId: '5' });

    await controller.getBookMetadata('5', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);
    await controller.deleteFromLibrary('5', { id: 4 } as never, { deviceId: 5, deviceToken: 'token-5' } as never, req as never, reply as never);
    await controller.getReadingState('5', { id: 4 } as never, { deviceId: 5, deviceToken: 'token-5' } as never, req as never, reply as never);
    await controller.getReadingState('5', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);

    expect(syncService.getBookMetadata).toHaveBeenCalledWith(4, 5, 'token-5', 'http://localhost:3000');
    expect(syncService.removeBookFromSync).toHaveBeenCalledWith(4, 5, 5);
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenNthCalledWith(1, [{ Title: 'Dune' }]);
    expect(reply.send).toHaveBeenNthCalledWith(2);
    expect(reply.send).toHaveBeenNthCalledWith(3, []);
    expect(reply.send).toHaveBeenNthCalledWith(4, [{ EntitlementId: '5' }]);
  });

  it('resolves Kobo UUID entitlement ids before calling services', async () => {
    const req = { headers: { host: 'localhost:3000' }, protocol: 'http', hostname: 'localhost', socket: { localPort: 3000 } };
    const reply = makeReply();
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(420);
    syncService.getBookMetadata.mockResolvedValue([{ Title: 'Mapped' }]);

    await controller.getBookMetadata('a-kobo-uuid', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);

    expect(syncService.getBookMetadata).toHaveBeenCalledWith(4, 420, 'token-5', 'http://localhost:3000');
    expect(reply.send).toHaveBeenCalledWith([{ Title: 'Mapped' }]);
  });

  it('updateReadingState uses first ReadingStates element when provided', async () => {
    settingsService.getSettings.mockResolvedValue({
      readingThreshold: 1,
      finishedThreshold: 99,
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
      twoWayProgressSync: true,
    });
    readingStateService.upsertState.mockResolvedValue({ RequestResult: 'Success' });
    const reply = makeReply();

    await controller.updateReadingState(
      '77',
      {
        ReadingStates: [{ EntitlementId: '77', CurrentBookmark: { ProgressPercent: 56 } }],
        CurrentBookmark: { ProgressPercent: 10 },
      },
      { id: 8 } as never,
      { deviceId: 77, deviceToken: 'dev77' } as never,
      { method: 'PUT', url: '/api/v1/kobo/dev77/v1/library/77/state' } as never,
      reply as never,
    );

    expect(readingStateService.upsertState).toHaveBeenCalledWith(
      8,
      77,
      { EntitlementId: '77', CurrentBookmark: { ProgressPercent: 56 } },
      1,
      99,
      true,
    );
    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 8,
        deviceId: 77,
        event: 'progress_update',
        counts: { progressUpdates: 1, twoWayProgressSync: true, bookId: 77, bookTitle: 'Dune' },
      }),
    );
    expect(historyService.countsForBook).toHaveBeenCalledWith(8, 77, { progressUpdates: 1, twoWayProgressSync: true });
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
  });

  it('records failed reading-state updates before rethrowing', async () => {
    const error = new Error('state failed');
    settingsService.getSettings.mockResolvedValue({
      readingThreshold: 1,
      finishedThreshold: 99,
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
      twoWayProgressSync: true,
    });
    readingStateService.upsertState.mockRejectedValue(error);
    const reply = makeReply();

    await expect(
      controller.updateReadingState(
        '77',
        { CurrentBookmark: { ProgressPercent: 56 } },
        { id: 8 } as never,
        { deviceId: 77, deviceToken: 'dev77' } as never,
        { method: 'PUT', url: '/api/v1/kobo/dev77/v1/library/77/state' } as never,
        reply as never,
      ),
    ).rejects.toThrow('state failed');

    expect(historyService.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, deviceId: 77, event: 'progress_update' }), error);
    expect(reply.send).not.toHaveBeenCalled();
  });
});
