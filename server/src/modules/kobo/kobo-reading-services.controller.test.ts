import { HttpStatus } from '@nestjs/common';

import { KoboReadingServicesController } from './kobo-reading-services.controller';

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
    patchContentAnnotations: vi.fn(),
    getChangedContentIds: vi.fn(),
  };
  const historyService = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    countsForBook: vi.fn(),
  };
  const controller = new KoboReadingServicesController(exchangeService as never, historyService as never);

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
    expect(reply.raw.once).toHaveBeenCalledWith('finish', expect.any(Function));
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

  it('delegates changed content and storage metadata without history rows', async () => {
    exchangeService.getChangedContentIds.mockResolvedValue(['book-1']);

    await expect(controller.checkForChanges({ id: 8 } as never, { deviceId: 5 } as never)).resolves.toEqual(['book-1']);
    expect(controller.getUserStorageMetadata()).toEqual({ continuationToken: null, metadata: [] });
    expect(historyService.recordSuccess).not.toHaveBeenCalled();
  });
});
