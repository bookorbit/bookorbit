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

  const controller = new KoboSyncController(settingsService as never, syncService as never, readingStateService as never, proxyService as never);

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('librarySync sets response headers and sends entitlement payload', async () => {
    settingsService.getSettings.mockResolvedValue({
      readingThreshold: 2.5,
      finishedThreshold: 95,
      twoWayProgressSync: true,
    });
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

    await controller.librarySync({ deviceToken: 'token-9' } as never, { id: 21 } as never, 'old-sync', req as never, reply as never);

    expect(settingsService.getSettings).toHaveBeenCalledWith(21);
    expect(syncService.getDelta).toHaveBeenCalledWith(21, 'token-9', 'http://kobo.local:3000', 'old-sync', {
      readingThreshold: 2.5,
      finishedThreshold: 95,
      twoWayProgressSync: true,
    });
    expect(reply.header).toHaveBeenCalledWith('x-kobo-sync', 'continue');
    expect(reply.header).toHaveBeenCalledWith('x-kobo-synctoken', 'SYNC-2');
    expect(reply.send).toHaveBeenCalledWith([{ NewEntitlement: { BookEntitlement: { Id: '12' } } }]);
  });

  it('proxies metadata/state/delete for non-numeric book ids', async () => {
    const req = { method: 'GET', url: '/api/v1/kobo/token/v1/library/abc/metadata' };
    const reply = makeReply();

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
    await controller.deleteFromLibrary('5', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);
    await controller.getReadingState('5', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);
    await controller.getReadingState('5', { id: 4 } as never, { deviceToken: 'token-5' } as never, req as never, reply as never);

    expect(syncService.getBookMetadata).toHaveBeenCalledWith(4, 5, 'token-5', 'http://localhost:3000');
    expect(syncService.removeBookFromSync).toHaveBeenCalledWith(4, 5);
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(reply.send).toHaveBeenNthCalledWith(1, [{ Title: 'Dune' }]);
    expect(reply.send).toHaveBeenNthCalledWith(2);
    expect(reply.send).toHaveBeenNthCalledWith(3, []);
    expect(reply.send).toHaveBeenNthCalledWith(4, [{ EntitlementId: '5' }]);
  });

  it('updateReadingState reads thresholds and uses first ReadingStates element when provided', async () => {
    settingsService.getSettings.mockResolvedValue({
      readingThreshold: 3,
      finishedThreshold: 92,
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
      { deviceToken: 'dev77' } as never,
      { method: 'PUT', url: '/api/v1/kobo/dev77/v1/library/77/state' } as never,
      reply as never,
    );

    expect(settingsService.getSettings).toHaveBeenCalledWith(8);
    expect(readingStateService.upsertState).toHaveBeenCalledWith(8, 77, { EntitlementId: '77', CurrentBookmark: { ProgressPercent: 56 } }, 3, 92);
    expect(reply.send).toHaveBeenCalledWith({ RequestResult: 'Success' });
  });
});
