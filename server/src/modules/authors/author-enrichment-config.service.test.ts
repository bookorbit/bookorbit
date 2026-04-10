import type { AuthorAutoEnrichmentConfig } from '@projectx/types';

import { DEFAULT_AUTHOR_ENRICHMENT_CONFIG, AuthorEnrichmentConfigService } from './author-enrichment-config.service';

function makeService() {
  const findFirst = vi.fn();
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const db = {
    query: {
      appSettings: {
        findFirst,
      },
    },
    insert,
  };

  return {
    service: new AuthorEnrichmentConfigService(db as never),
    db,
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

  it('falls back to defaults when stored config JSON is malformed', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue({ value: '{invalid-json' });

    await expect(service.getConfig()).resolves.toEqual(DEFAULT_AUTHOR_ENRICHMENT_CONFIG);
  });

  it('persists config through upsert', async () => {
    const { service, insert, values, onConflictDoUpdate } = makeService();
    const config: AuthorAutoEnrichmentConfig = {
      enabled: true,
      triggerOnImport: false,
      writeMode: 'always_refetch',
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
