import { HttpStatus, NotFoundException } from '@nestjs/common';

import { KoboReadingServicesController } from './kobo-reading-services.controller';
import { KoboContentNotFoundException } from './services/kobo-annotation-exchange.service';

function makeReply() {
  return {
    raw: { once: vi.fn() },
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('KoboReadingServicesController', () => {
  const exchangeService = {
    getContentAnnotations: vi.fn(),
    markServedSeen: vi.fn(),
    rememberServe: vi.fn(),
    patchContentAnnotations: vi.fn(),
    getChangedContentIds: vi.fn(),
  };
  const historyService = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    countsForBook: vi.fn(),
  };
  const proxyService = { forward: vi.fn() };
  const settingsService = { getSettings: vi.fn() };
  const controller = new KoboReadingServicesController(
    exchangeService as never,
    historyService as never,
    proxyService as never,
    settingsService as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    historyService.countsForBook.mockImplementation((_userId: number, bookId: number, counts: Record<string, unknown>) => ({
      ...counts,
      bookId,
      bookTitle: 'Dune',
    }));
  });

  it('records successful annotation pulls and sends the response', async () => {
    const servedAck = { entries: [], tombstoneStateIds: [12] };
    const response = { annotations: [{ id: 'a1' }], nextPageOffsetToken: null };
    exchangeService.getContentAnnotations.mockResolvedValue({
      bookId: 42,
      etag: '"abc"',
      notModified: false,
      response,
      servedAck,
      servedCount: 1,
      tombstoneCount: 1,
    });
    const reply = makeReply();

    await controller.getAnnotations('content-1', undefined, { id: 8 } as never, { deviceId: 5 } as never, reply as never);

    expect(exchangeService.getContentAnnotations).toHaveBeenCalledWith(8, 'content-1', 5, undefined);
    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 8,
        deviceId: 5,
        event: 'annotations_pull',
        counts: { served: 1, tombstones: 1, notModified: false, bookId: 42, bookTitle: 'Dune' },
      }),
    );
    expect(historyService.countsForBook).toHaveBeenCalledWith(8, 42, { served: 1, tombstones: 1, notModified: false });
    expect(reply.header).toHaveBeenCalledWith('ETag', '"abc"');
    expect(exchangeService.markServedSeen).not.toHaveBeenCalled();
    expect(exchangeService.rememberServe).toHaveBeenCalledWith(8, 5, 42, '"abc"', servedAck);
    expect(reply.send).toHaveBeenCalledWith(response);
  });

  it('records not-modified annotation pulls', async () => {
    exchangeService.getContentAnnotations.mockResolvedValue({
      bookId: 42,
      etag: '"abc"',
      notModified: true,
      servedAck: { entries: [], tombstoneStateIds: [] },
      servedCount: 0,
      tombstoneCount: 0,
    });
    const reply = makeReply();

    await controller.getAnnotations('content-1', 'W/"0"', { id: 8 } as never, { deviceId: 5 } as never, reply as never);

    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'annotations_pull',
        counts: { served: 0, tombstones: 0, notModified: true, bookId: 42, bookTitle: 'Dune' },
      }),
    );
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(reply.send).toHaveBeenCalledWith();
    expect(exchangeService.markServedSeen).toHaveBeenCalledWith(8, 5, { entries: [], tombstoneStateIds: [] });
  });

  it('records failed annotation pulls before rethrowing', async () => {
    const error = new Error('annotation lookup failed');
    exchangeService.getContentAnnotations.mockRejectedValueOnce(error);
    const reply = makeReply();

    await expect(controller.getAnnotations('content-1', undefined, { id: 8 } as never, { deviceId: 5 } as never, reply as never)).rejects.toThrow(
      'annotation lookup failed',
    );

    expect(historyService.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, deviceId: 5, event: 'annotations_pull' }), error);
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('does not record a failure when a pulled content id is not a BookOrbit book', async () => {
    exchangeService.getContentAnnotations.mockRejectedValueOnce(new KoboContentNotFoundException('1894971763'));
    const reply = makeReply();

    await expect(controller.getAnnotations('1894971763', undefined, { id: 8 } as never, { deviceId: 5 } as never, reply as never)).rejects.toThrow(
      KoboContentNotFoundException,
    );

    expect(historyService.recordFailure).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('records successful annotation pushes', async () => {
    exchangeService.patchContentAnnotations.mockResolvedValue({
      bookId: 42,
      created: 2,
      updated: 1,
      unchanged: 3,
      deleted: 1,
      kepubReady: true,
    });

    await controller.patchAnnotations('content-1', { annotations: [] }, { id: 8 } as never, { deviceId: 5 } as never);

    expect(exchangeService.patchContentAnnotations).toHaveBeenCalledWith(8, 'content-1', { annotations: [] }, 5);
    expect(historyService.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 8,
        deviceId: 5,
        event: 'annotations_push',
        counts: { created: 2, updated: 1, unchanged: 3, deleted: 1, kepubReady: true, bookId: 42, bookTitle: 'Dune' },
      }),
    );
    expect(historyService.countsForBook).toHaveBeenCalledWith(8, 42, { created: 2, updated: 1, unchanged: 3, deleted: 1, kepubReady: true });
  });

  it('records failed annotation pushes before rethrowing', async () => {
    const error = new Error('annotation write failed');
    exchangeService.patchContentAnnotations.mockRejectedValueOnce(error);

    await expect(controller.patchAnnotations('content-1', {}, { id: 8 } as never, { deviceId: 5 } as never)).rejects.toThrow(
      'annotation write failed',
    );

    expect(historyService.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, deviceId: 5, event: 'annotations_push' }), error);
  });

  it('does not record a failure when a pushed content id is not a BookOrbit book', async () => {
    exchangeService.patchContentAnnotations.mockRejectedValueOnce(new KoboContentNotFoundException('1894971763'));

    await expect(controller.patchAnnotations('1894971763', {}, { id: 8 } as never, { deviceId: 5 } as never)).rejects.toThrow(
      KoboContentNotFoundException,
    );

    expect(historyService.recordFailure).not.toHaveBeenCalled();
  });

  it('delegates changed content without history rows', async () => {
    exchangeService.getChangedContentIds.mockResolvedValue(['book-1']);
    const body = [{ ContentId: 'book-1', etag: 'W/"1"' }];

    await expect(controller.checkForChanges(body, { id: 8 } as never, { deviceId: 5 } as never)).resolves.toEqual(['book-1']);
    expect(exchangeService.getChangedContentIds).toHaveBeenCalledWith(8, 5, body);
    expect(historyService.recordSuccess).not.toHaveBeenCalled();
  });

  describe('notebook storage', () => {
    const device = { deviceId: 5, deviceToken: 'token-5', userId: 8 };

    it('relays notebook calls to Kobo when store titles are on', async () => {
      settingsService.getSettings.mockResolvedValue({ storeSync: true });
      const req = { method: 'POST', url: '/api/UserStorage/Metadata' };
      const reply = makeReply();

      await controller.userStorage({ id: 8 } as never, device as never, req as never, reply as never);

      expect(proxyService.forward).toHaveBeenCalledWith(req, reply, 'token-5', 'readingServices');
    });

    it('answers an empty notebook listing and nothing else when store titles are off', async () => {
      settingsService.getSettings.mockResolvedValue({ storeSync: false });
      const reply = makeReply();

      await controller.userStorage(
        { id: 8 } as never,
        device as never,
        { method: 'GET', url: '/api/UserStorage/Metadata?x=1' } as never,
        reply as never,
      );
      expect(reply.send).toHaveBeenCalledWith({ continuationToken: null, metadata: [] });

      await expect(
        controller.userStorage(
          { id: 8 } as never,
          device as never,
          { method: 'POST', url: '/api/UserStorage/Metadata' } as never,
          makeReply() as never,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(proxyService.forward).not.toHaveBeenCalled();
    });

    it('keeps notebook sync local when the setting cannot be read', async () => {
      settingsService.getSettings.mockRejectedValue(new Error('settings unavailable'));
      const reply = makeReply();

      await controller.userStorage({ id: 8 } as never, device as never, { method: 'GET', url: '/api/UserStorage/Metadata' } as never, reply as never);

      expect(proxyService.forward).not.toHaveBeenCalled();
      expect(reply.send).toHaveBeenCalledWith({ continuationToken: null, metadata: [] });
    });
  });
});
