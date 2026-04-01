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
});
