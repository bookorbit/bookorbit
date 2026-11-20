import { ValidationPipe } from '@nestjs/common';
import type { AuthorAutoEnrichmentConfig, AuthorMetadataPreferences } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { DEFAULT_AUTHOR_ENRICHMENT_CONFIG, AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { AuthorMetadataPreferencesService } from './author-metadata-preferences.service';
import { AuthorAutoEnrichmentConfigDto } from './dto/author-auto-enrichment-config.dto';
import { AuthorMetadataPreferenceResolver } from './metadata/author-metadata-preference-resolver';

function makeService() {
  const findFirst = vi.fn();
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn<(row: { key: string; value: string }) => unknown>().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  const db = {
    query: {
      appSettings: {
        findFirst,
      },
    },
    insert,
  };

  const preferences = new AuthorMetadataPreferencesService(db as never, new AuthorMetadataPreferenceResolver());
  return {
    service: new AuthorEnrichmentConfigService(db as never, preferences),
    insert,
    findFirst,
    values,
    onConflictDoUpdate,
  };
}

describe('AuthorEnrichmentConfigService', () => {
  it('returns deep-cloned defaults when no config is stored', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue(null);

    const result = await service.getConfig();

    expect(result).toEqual(DEFAULT_AUTHOR_ENRICHMENT_CONFIG);
    expect(result).not.toBe(DEFAULT_AUTHOR_ENRICHMENT_CONFIG);
    expect(result.conditions).not.toBe(DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions);
  });

  it('merges partial stored config with defaults', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue({
      value: JSON.stringify({
        enabled: true,
        conditions: {
          missingBio: false,
        },
      }),
    });

    const result = await service.getConfig();

    expect(result.enabled).toBe(true);
    expect(result.conditions.missingBio).toBe(false);
    expect(result.conditions.missingPhoto).toBe(DEFAULT_AUTHOR_ENRICHMENT_CONFIG.conditions.missingPhoto);
  });

  it('saves an upgraded config and migrates its legacy write mode before replacing it', async () => {
    const { service, findFirst, values } = makeService();
    const stored = {
      enabled: false,
      triggerOnImport: false,
      writeMode: 'always_refetch',
      conditions: { neverEnriched: false, missingBio: true, missingPhoto: true },
    };
    const legacyRow = { value: JSON.stringify(stored) };
    findFirst.mockResolvedValueOnce(legacyRow).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(legacyRow);

    const loaded = await service.getConfig();
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const update = (await pipe.transform(
      { ...loaded, enabled: true },
      { type: 'body', metatype: AuthorAutoEnrichmentConfigDto },
    )) as AuthorAutoEnrichmentConfigDto;

    await service.setConfig(update);

    expect(values).toHaveBeenNthCalledWith(1, { key: APP_SETTING_KEYS.AUTHORS_METADATA_PREFERENCES, value: expect.any(String) });
    const migrated = JSON.parse(values.mock.calls[0]![0].value) as AuthorMetadataPreferences;
    expect(migrated.fields.description.mergeStrategy).toBe('overwriteIfProvided');
    expect(values).toHaveBeenNthCalledWith(2, {
      key: APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG,
      value: JSON.stringify({ enabled: true, triggerOnImport: false, conditions: stored.conditions }),
    });
  });

  it('falls back to defaults when stored config JSON is malformed', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue({ value: '{invalid-json' });

    await expect(service.getConfig()).resolves.toEqual(DEFAULT_AUTHOR_ENRICHMENT_CONFIG);
  });

  it('persists config through upsert', async () => {
    const { service, findFirst, insert, values, onConflictDoUpdate } = makeService();
    findFirst.mockResolvedValue({ value: '{}' });
    const config: AuthorAutoEnrichmentConfig = {
      enabled: true,
      triggerOnImport: false,
      conditions: {
        neverEnriched: true,
        missingBio: true,
        missingPhoto: false,
      },
    };

    await service.setConfig(config);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        value: JSON.stringify(config),
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('reads and writes paused flag as string booleans', async () => {
    const { service, findFirst, values } = makeService();
    findFirst.mockResolvedValueOnce({ value: 'true' }).mockResolvedValueOnce({ value: 'false' });

    await expect(service.isPaused()).resolves.toBe(true);
    await expect(service.isPaused()).resolves.toBe(false);

    await service.setPaused(true);
    await service.setPaused(false);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ value: 'true' }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ value: 'false' }));
  });
});
