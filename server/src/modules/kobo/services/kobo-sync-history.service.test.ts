import { KoboSyncHistoryService } from './kobo-sync-history.service';

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function makeBookAccessService() {
  return {
    assertBookAccessible: vi.fn().mockResolvedValue(undefined),
  };
}

describe('KoboSyncHistoryService', () => {
  it('lists recent history for a user and normalizes response fields', async () => {
    const rows = [
      {
        id: 12,
        deviceId: 3,
        deviceName: 'Kobo Libra',
        event: 'library_sync',
        status: 'success',
        counts: { entitlements: 4, hasMore: false },
        durationMs: 42,
        errorClass: null,
        error: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      {
        id: 11,
        deviceId: null,
        deviceName: null,
        event: 'book_download',
        status: 'failed',
        counts: null,
        durationMs: 5,
        errorClass: 'NotFoundException',
        error: 'File not found',
        createdAt: new Date('2026-06-01T09:00:00.000Z'),
      },
    ];
    const selectChain = makeSelectChain(rows);
    const db = { select: vi.fn().mockReturnValue(selectChain) };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await expect(service.listForUser(7, 500)).resolves.toEqual([
      {
        id: 12,
        deviceId: 3,
        deviceName: 'Kobo Libra',
        event: 'library_sync',
        status: 'success',
        counts: { entitlements: 4, hasMore: false },
        durationMs: 42,
        errorClass: null,
        error: null,
        createdAt: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 11,
        deviceId: null,
        deviceName: null,
        event: 'book_download',
        status: 'failed',
        counts: {},
        durationMs: 5,
        errorClass: 'NotFoundException',
        error: 'File not found',
        createdAt: '2026-06-01T09:00:00.000Z',
      },
    ]);

    expect(selectChain.limit).toHaveBeenCalledWith(100);
  });

  it('applies default limit of 20 when no limit argument is passed', async () => {
    const selectChain = makeSelectChain([]);
    const db = { select: vi.fn().mockReturnValue(selectChain) };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await service.listForUser(7);

    expect(selectChain.limit).toHaveBeenCalledWith(20);
  });

  it('clamps limit to minimum of 1 when zero is passed', async () => {
    const selectChain = makeSelectChain([]);
    const db = { select: vi.fn().mockReturnValue(selectChain) };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await service.listForUser(7, 0);

    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it('records successful events and prunes old user history', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn().mockReturnValue({ values }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await service.recordSuccess({
      userId: 7,
      deviceId: 3,
      event: 'library_sync',
      durationMs: 12.9,
      counts: { entitlements: 4, hasMore: false },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        deviceId: 3,
        event: 'library_sync',
        status: 'success',
        counts: { entitlements: 4, hasMore: false },
        durationMs: 12,
        errorClass: null,
        error: null,
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('records failed events with sanitized short error fields', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn().mockReturnValue({ values }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await service.recordFailure(
      {
        userId: 7,
        deviceId: 3,
        event: 'progress_update',
        durationMs: -10,
      },
      new Error('bad "thing"\\path\nnext line'),
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        deviceId: 3,
        event: 'progress_update',
        status: 'failed',
        counts: {},
        durationMs: 0,
        errorClass: 'Error',
        error: 'bad \\"thing\\"\\\\path next line',
      }),
    );
  });

  it('records failed events from non-Error values', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn().mockReturnValue({ values }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await service.recordFailure(
      {
        userId: 7,
        deviceId: 3,
        event: 'annotations_push',
        durationMs: 4,
      },
      'string failure',
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorClass: 'Error',
        error: 'string failure',
      }),
    );
  });

  it('does not throw when recording history fails', async () => {
    const db = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockRejectedValue(new Error('db unavailable')) }),
      execute: vi.fn(),
    };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await expect(
      service.recordSuccess({
        userId: 7,
        deviceId: 3,
        event: 'annotations_pull',
        durationMs: 1,
      }),
    ).resolves.toBeUndefined();

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does not throw when recording history fails with a non-Error value', async () => {
    const db = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockRejectedValue('db unavailable') }),
      execute: vi.fn(),
    };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await expect(
      service.recordSuccess({
        userId: 7,
        deviceId: 3,
        event: 'annotations_pull',
        durationMs: 1,
      }),
    ).resolves.toBeUndefined();

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('adds book context to history counts', async () => {
    const selectChain = makeSelectChain([{ title: 'Dune' }]);
    const db = { select: vi.fn().mockReturnValue(selectChain) };
    const bookAccessService = makeBookAccessService();
    const service = new KoboSyncHistoryService(db as never, bookAccessService as never);

    await expect(service.countsForBook(7, 44, { progressUpdates: 1 })).resolves.toEqual({
      progressUpdates: 1,
      bookId: 44,
      bookTitle: 'Dune',
    });

    expect(bookAccessService.assertBookAccessible).toHaveBeenCalledWith(7, 44);
    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it('keeps a null book title when the book card is not found', async () => {
    const selectChain = makeSelectChain([]);
    const db = { select: vi.fn().mockReturnValue(selectChain) };
    const service = new KoboSyncHistoryService(db as never, makeBookAccessService() as never);

    await expect(service.countsForBook(7, 45)).resolves.toEqual({
      bookId: 45,
      bookTitle: null,
    });
  });

  it('keeps counts when book context lookup is not accessible', async () => {
    const db = { select: vi.fn() };
    const bookAccessService = {
      assertBookAccessible: vi.fn().mockRejectedValue(new Error('not allowed')),
    };
    const service = new KoboSyncHistoryService(db as never, bookAccessService as never);

    await expect(service.countsForBook(7, 45, { downloads: 1 })).resolves.toEqual({
      downloads: 1,
      bookId: 45,
      bookTitle: null,
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
