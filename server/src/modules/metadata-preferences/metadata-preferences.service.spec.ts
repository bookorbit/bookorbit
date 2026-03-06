import { NotFoundException } from '@nestjs/common';
import { MetadataProviderKey } from '@projectx/types';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesService } from './metadata-preferences.service';

function createResolver() {
  const resolver = new MetadataPreferenceResolver();
  return {
    getDefaultPreferences: jest.fn(() => resolver.getDefaultPreferences()),
    resolve: jest.fn((global, overrides) => resolver.resolve(global, overrides)),
  } as unknown as jest.Mocked<MetadataPreferenceResolver>;
}

function createDb() {
  const insertChain = {
    values: jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
  };

  const updateChain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([]),
  };

  return {
    query: {
      appSettings: {
        findFirst: jest.fn(),
      },
      libraries: {
        findFirst: jest.fn(),
      },
    },
    insert: jest.fn().mockReturnValue(insertChain),
    update: jest.fn().mockReturnValue(updateChain),
    __insertChain: insertChain,
    __updateChain: updateChain,
  };
}

describe('MetadataPreferencesService', () => {
  let db: ReturnType<typeof createDb>;
  let resolver: jest.Mocked<MetadataPreferenceResolver>;
  let service: MetadataPreferencesService;

  beforeEach(() => {
    db = createDb();
    resolver = createResolver();
    service = new MetadataPreferencesService(db as never, resolver);
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

  it('clears one library override and stores null when no overrides remain', async () => {
    db.query.libraries.findFirst.mockResolvedValue({
      metadataFetchPreferences: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
    });

    await service.setLibraryFieldOverride(3, 'title', null);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.__updateChain.set).toHaveBeenCalledWith({ metadataFetchPreferences: null });
    expect(db.__updateChain.where).toHaveBeenCalledTimes(1);
  });

  it('writes or replaces a single library override', async () => {
    db.query.libraries.findFirst.mockResolvedValue({
      metadataFetchPreferences: {
        subtitle: {
          enabled: false,
          providers: [MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'overwriteIfProvided',
        },
      },
    });

    await service.setLibraryFieldOverride(4, 'title', {
      enabled: true,
      providers: [MetadataProviderKey.GOODREADS],
      mergeStrategy: 'overwrite',
    });

    expect(db.__updateChain.set).toHaveBeenCalledWith({
      metadataFetchPreferences: expect.objectContaining({
        subtitle: expect.any(Object),
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOODREADS],
          mergeStrategy: 'overwrite',
        },
      }),
    });
  });

  it('throws NotFoundException when writing an override for a missing library', async () => {
    db.query.libraries.findFirst.mockResolvedValue(undefined);

    await expect(
      service.setLibraryFieldOverride(10, 'title', {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('resets a library to global preferences and throws when library is missing', async () => {
    db.__updateChain.returning.mockResolvedValueOnce([{ id: 5 }]);

    await expect(service.resetLibraryToGlobal(5)).resolves.toBeUndefined();

    db.__updateChain.returning.mockResolvedValueOnce([]);
    await expect(service.resetLibraryToGlobal(50)).rejects.toThrow(NotFoundException);
  });
});
