import { Logger } from '@nestjs/common';

import { BookMetadataFetchConfigService, DEFAULT_BOOK_METADATA_FETCH_CONFIG } from './book-metadata-fetch-config.service';

describe('BookMetadataFetchConfigService', () => {
  const makeService = () => {
    const db = {
      query: {
        appSettings: {
          findFirst: vi.fn(),
        },
        libraries: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
    };

    return {
      db,
      service: new BookMetadataFetchConfigService(db as never),
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults when global config is missing', async () => {
    const { db, service } = makeService();
    db.query.appSettings.findFirst.mockResolvedValueOnce(undefined);

    await expect(service.getGlobalConfig()).resolves.toEqual(DEFAULT_BOOK_METADATA_FETCH_CONFIG);
  });

  it('logs and falls back to defaults when stored global config is invalid JSON', async () => {
    const { db, service } = makeService();
    db.query.appSettings.findFirst.mockResolvedValueOnce({ value: '{"enabled":true' });
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.getGlobalConfig()).resolves.toEqual(DEFAULT_BOOK_METADATA_FETCH_CONFIG);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('book.metadata_fetch.config_parse'));
  });

  it('deep-merges a library override onto global config', async () => {
    const { db, service } = makeService();
    db.query.appSettings.findFirst.mockResolvedValueOnce({
      value: JSON.stringify({
        enabled: true,
        triggerOnImport: false,
        conditions: {
          neverFetched: { enabled: true },
          scoreThreshold: { enabled: true, threshold: 70 },
          missingFields: { enabled: true, fields: ['description'] },
        },
      }),
    });
    db.query.libraries.findFirst.mockResolvedValueOnce({
      bookMetadataFetchConfig: {
        triggerOnImport: true,
        conditions: {
          scoreThreshold: { threshold: 50 },
        },
      },
    });

    await expect(service.getEffectiveConfig(42)).resolves.toEqual({
      enabled: true,
      triggerOnImport: true,
      conditions: {
        neverFetched: { enabled: true },
        scoreThreshold: { enabled: true, threshold: 50 },
        missingFields: { enabled: true, fields: ['description'] },
      },
    });
  });

  it('setGlobalConfig upserts serialized config payload', async () => {
    const { db, service } = makeService();
    const insertChain = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
    };
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    db.insert.mockReturnValue(insertChain);

    await service.setGlobalConfig({
      enabled: true,
      triggerOnImport: false,
      conditions: {
        neverFetched: { enabled: true },
        scoreThreshold: { enabled: false, threshold: 60 },
        missingFields: { enabled: true, fields: ['description'] },
      },
    });

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'book_metadata_fetch_config',
      }),
    );
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it('isPaused and setPaused read/write paused key as string booleans', async () => {
    const { db, service } = makeService();
    db.query.appSettings.findFirst.mockResolvedValueOnce({ value: 'true' }).mockResolvedValueOnce({ value: 'false' });
    const insertChain = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
    };
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    db.insert.mockReturnValue(insertChain);

    await expect(service.isPaused()).resolves.toBe(true);
    await expect(service.isPaused()).resolves.toBe(false);
    await service.setPaused(true);

    expect(insertChain.values).toHaveBeenCalledWith({
      key: 'book_metadata_fetch_paused',
      value: 'true',
    });
  });

  it('getLibraryConfigWithLastRun and recordLibraryRun map persisted run metadata', async () => {
    const { db, service } = makeService();
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify(DEFAULT_BOOK_METADATA_FETCH_CONFIG),
    });
    db.query.libraries.findFirst.mockResolvedValueOnce({
      bookMetadataFetchConfig: null,
    });
    db.query.libraries.findFirst.mockResolvedValueOnce({
      bookMetadataFetchLastRunAt: new Date('2026-01-01T00:00:00.000Z'),
      bookMetadataFetchLastQueuedCount: 17,
    });
    const updateChain = {
      set: vi.fn(),
      where: vi.fn(),
    };
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockResolvedValue(undefined);
    db.update.mockReturnValue(updateChain);

    await expect(service.getLibraryConfigWithLastRun(9)).resolves.toEqual({
      ...DEFAULT_BOOK_METADATA_FETCH_CONFIG,
      lastRunAt: '2026-01-01T00:00:00.000Z',
      lastQueuedCount: 17,
    });

    await service.recordLibraryRun(9, 20);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bookMetadataFetchLastRunAt: expect.any(Date),
        bookMetadataFetchLastQueuedCount: 20,
      }),
    );
  });
});
