import { Logger, NotFoundException } from '@nestjs/common';
import type { Mocked } from 'vitest';
import { MetadataProviderKey } from '@projectx/types';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesService } from './metadata-preferences.service';

function createResolver() {
  const resolver = new MetadataPreferenceResolver();
  return {
    getDefaultPreferences: vi.fn(() => resolver.getDefaultPreferences()),
    resolve: vi.fn((global, overrides) => resolver.resolve(global, overrides)),
  } as unknown as Mocked<MetadataPreferenceResolver>;
}

function createDb() {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  return {
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
      libraries: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    __insertChain: insertChain,
    __updateChain: updateChain,
  };
}

describe('MetadataPreferencesService', () => {
  let db: ReturnType<typeof createDb>;
  let resolver: Mocked<MetadataPreferenceResolver>;
  let service: MetadataPreferencesService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createDb();
    resolver = createResolver();
    service = new MetadataPreferencesService(db as never, resolver);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns defaults when global preferences are missing', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    const prefs = await service.getGlobal();

    expect(resolver.getDefaultPreferences).toHaveBeenCalled();
    expect(prefs.fields.title.providers).toContain(MetadataProviderKey.GOOGLE);
  });

  it('normalizes persisted global preferences before returning them', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      value: JSON.stringify({
        fields: {
          title: {
            enabled: true,
            providers: [MetadataProviderKey.OPEN_LIBRARY],
            mergeStrategy: 'fillMissing',
          },
        },
      }),
    });

    const prefs = await service.getGlobal();

    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          title: expect.any(Object),
        }),
      }),
      null,
    );
    expect(prefs.fields.subtitle.providers).toContain(MetadataProviderKey.GOOGLE);
  });

  it('falls back to defaults when persisted global preferences contain invalid JSON', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({ value: '{broken' });

    const prefs = await service.getGlobal();

    expect(resolver.getDefaultPreferences).toHaveBeenCalled();
    expect(prefs.fields.cover.enabled).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata_preferences.global_parse] [fail] key=metadata_fetch_preferences durationMs='),
    );
  });

  it('escapes quotes in parse errors before logging', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({ value: '{"fields":{}}' });
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new Error('invalid "json" payload');
    });

    await service.getGlobal();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="invalid \\"json\\" payload"'));
    parseSpy.mockRestore();
  });

  it('normalizes and upserts global preferences', async () => {
    const prefs = resolver.getDefaultPreferences();
    prefs.fields.title.providers = [MetadataProviderKey.OPEN_LIBRARY];

    await service.setGlobal(prefs);

    expect(resolver.resolve).toHaveBeenCalledWith(prefs, null);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.__insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'metadata_fetch_preferences',
        value: expect.any(String),
      }),
    );
    expect(db.__insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when requesting preferences for a missing library', async () => {
    db.query.libraries.findFirst.mockResolvedValue(undefined);

    await expect(service.getForLibrary(99)).rejects.toThrow(NotFoundException);
  });

  it('resolves effective preferences for a library using provided global preferences', async () => {
    const global = resolver.getDefaultPreferences();
    const titleOverride = {
      enabled: true,
      providers: [MetadataProviderKey.AMAZON],
      mergeStrategy: 'overwrite',
    };
    db.query.libraries.findFirst.mockResolvedValue({
      metadataFetchPreferences: {
        title: titleOverride,
      },
    });

    const result = await service.getForLibrary(7, global);

    expect(result.libraryId).toBe(7);
    expect(result.overrides).toEqual({ title: titleOverride });
    expect(result.effective.fields.title.providers).toEqual([MetadataProviderKey.AMAZON]);
  });

  it('writes library overrides and stores null when overrides object is empty', async () => {
    db.query.libraries.findFirst.mockResolvedValue({ id: 3 });

    await service.setLibraryOverrides(3, {});

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.__updateChain.set).toHaveBeenCalledWith({ metadataFetchPreferences: null });
    expect(db.__updateChain.where).toHaveBeenCalledTimes(1);
  });

  it('writes library overrides when overrides object is non-empty', async () => {
    db.query.libraries.findFirst.mockResolvedValue({ id: 4 });

    const overrides = {
      title: {
        enabled: true,
        providers: [MetadataProviderKey.GOODREADS],
        mergeStrategy: 'overwrite',
      },
    };

    await service.setLibraryOverrides(4, overrides);

    expect(db.__updateChain.set).toHaveBeenCalledWith({ metadataFetchPreferences: overrides });
  });

  it('throws NotFoundException when writing overrides for a missing library', async () => {
    db.query.libraries.findFirst.mockResolvedValue(undefined);

    await expect(service.setLibraryOverrides(10, {})).rejects.toThrow(NotFoundException);
  });

  it('resets a library to global preferences and throws when library is missing', async () => {
    db.__updateChain.returning.mockResolvedValueOnce([{ id: 5 }]);

    await expect(service.resetLibraryToGlobal(5)).resolves.toBeUndefined();

    db.__updateChain.returning.mockResolvedValueOnce([]);
    await expect(service.resetLibraryToGlobal(50)).rejects.toThrow(NotFoundException);
  });
});
