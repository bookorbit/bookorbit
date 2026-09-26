import { Logger, NotFoundException } from '@nestjs/common';
import type { Mocked } from 'vitest';
import { MetadataProviderKey } from '@bookorbit/types';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesService } from './metadata-preferences.service';

function createResolver() {
  const resolver = new MetadataPreferenceResolver();
  return {
    getDefaultPreferences: vi.fn(() => resolver.getDefaultPreferences()),
    resolve: vi.fn((global, overrides) => resolver.resolve(global, overrides)),
    withSeededAudioCoverRule: vi.fn((fields) => resolver.withSeededAudioCoverRule(fields)),
  } as unknown as Mocked<MetadataPreferenceResolver>;
}

function createDb() {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
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
    select: vi.fn().mockReturnValue(selectChain),
    __insertChain: insertChain,
    __updateChain: updateChain,
    __selectChain: selectChain,
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

  describe('seedAudioCoverRules', () => {
    const cover = { enabled: false, mergeStrategy: 'fillMissing', providers: [MetadataProviderKey.AMAZON] };

    it('writes an Audiobook cover rule into every stored scope that has only a Cover rule, then marks itself done', async () => {
      db.query.appSettings.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        key: 'metadata_fetch_preferences',
        value: JSON.stringify({ fields: { cover }, options: { saveProviderIds: true } }),
      });
      db.__selectChain.where.mockResolvedValue([
        { id: 1, overrides: { cover } },
        { id: 2, overrides: { cover, audioCover: { enabled: true, mergeStrategy: 'overwrite', providers: [] } } },
        { id: 3, overrides: { title: { enabled: true, mergeStrategy: 'overwrite', providers: [] } } },
      ]);

      await expect(service.seedAudioCoverRules()).resolves.toEqual({ global: true, libraries: 1 });

      const [globalWrite, libraryWrite] = db.__updateChain.set.mock.calls.map(([values]) => values as Record<string, unknown>);
      const storedGlobal = JSON.parse(globalWrite!.value as string);
      expect(storedGlobal.options).toEqual({ saveProviderIds: true });
      expect(storedGlobal.fields.audioCover).toMatchObject({ enabled: false, mergeStrategy: 'fillMissing' });
      expect(libraryWrite!.metadataFetchPreferences).toMatchObject({ cover, audioCover: { enabled: false, mergeStrategy: 'fillMissing' } });
      expect(db.__updateChain.set).toHaveBeenCalledTimes(2);
      expect(db.__insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ key: 'metadata_fetch_audio_cover_rule_seeded' }));
    });

    it('does nothing once marked done, so a removed library override stays removed', async () => {
      db.query.appSettings.findFirst.mockResolvedValueOnce({ key: 'metadata_fetch_audio_cover_rule_seeded', value: '2026-09-23T00:00:00.000Z' });

      await expect(service.seedAudioCoverRules()).resolves.toBeNull();

      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });
  });
});
