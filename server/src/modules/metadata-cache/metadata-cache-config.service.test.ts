import { BadRequestException } from '@nestjs/common';
import { DEFAULT_METADATA_CACHE_CONFIG, METADATA_CACHE_LIMITS } from '@bookorbit/types';

import {
  effectiveCacheSettings,
  latestMarkerAt,
  MetadataCacheConfigService,
  normalizeMetadataCacheConfig,
  type ClearMarker,
} from './metadata-cache-config.service';
import { MetadataCacheProviderCatalog } from './metadata-cache-provider-catalog';
import type { MetadataCacheSettingsRepository } from './metadata-cache-settings.repository';

function settingsStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const repository = {
    read: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    update: vi.fn((key: string, apply: (current: string | null) => string) => {
      const next = apply(values.get(key) ?? null);
      values.set(key, next);
      return Promise.resolve(next);
    }),
  };
  return { repository, values };
}

describe('MetadataCacheConfigService', () => {
  function makeService(initial: Record<string, string> = {}) {
    const store = settingsStore(initial);
    const catalog = new MetadataCacheProviderCatalog();
    catalog.register('book', [{ provider: 'google', label: 'Google' }]);
    const service = new MetadataCacheConfigService(store.repository as unknown as MetadataCacheSettingsRepository, catalog);
    return { service, store };
  }

  it('returns defaults when nothing is stored or the stored value is corrupt', async () => {
    expect(await makeService().service.getConfig()).toEqual(DEFAULT_METADATA_CACHE_CONFIG);
    expect(await makeService({ metadata_cache_config: '{not json' }).service.getConfig()).toEqual(DEFAULT_METADATA_CACHE_CONFIG);
  });

  it('clamps stored values into range and drops malformed overrides', () => {
    const config = normalizeMetadataCacheConfig({
      resultsTtlSeconds: 1,
      emptyTtlSeconds: 10 ** 12,
      maxStorageMb: 'big',
      providerOverrides: [
        { namespace: 'book', provider: 'google', resultsTtlSeconds: 3600.7, enabled: false },
        { namespace: 'video', provider: 'x' },
        { namespace: 'book', provider: ' ' },
        { namespace: 'book', provider: 'google', emptyTtlSeconds: 0 },
      ],
    });

    expect(config.resultsTtlSeconds).toBe(METADATA_CACHE_LIMITS.resultsTtlSeconds.min);
    expect(config.emptyTtlSeconds).toBe(METADATA_CACHE_LIMITS.emptyTtlSeconds.max);
    expect(config.maxStorageMb).toBe(DEFAULT_METADATA_CACHE_CONFIG.maxStorageMb);
    expect(config.providerOverrides).toEqual([{ namespace: 'book', provider: 'google', emptyTtlSeconds: 0 }]);
  });

  it('merges a patch into the stored settings and serves the update immediately', async () => {
    const { service } = makeService();
    await service.getConfig();

    await service.updateConfig({ resultsTtlSeconds: 7200 });

    expect((await service.getConfig()).resultsTtlSeconds).toBe(7200);
  });

  it('rejects overrides for providers that do not exist', async () => {
    const { service } = makeService();

    await expect(service.updateConfig({ providerOverrides: [{ namespace: 'book', provider: 'nope' }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists and removes clear markers', async () => {
    const { service } = makeService();
    const at = new Date('2026-01-01T00:00:00Z');

    await service.addClearMarker({ namespace: 'book', provider: 'google' }, at);
    expect((await service.snapshot()).markers).toEqual([{ namespace: 'book', provider: 'google', at: at.toISOString() }]);

    await service.removeClearMarkers(() => true);
    expect((await service.snapshot()).markers).toEqual([]);
  });
});

describe('effectiveCacheSettings', () => {
  it('applies a provider override over the global defaults', () => {
    const config = {
      ...DEFAULT_METADATA_CACHE_CONFIG,
      providerOverrides: [{ namespace: 'book' as const, provider: 'google', resultsTtlSeconds: 60, enabled: false }],
    };

    expect(effectiveCacheSettings(config, 'book', 'google')).toMatchObject({ enabled: false, resultsTtlMs: 60_000 });
    expect(effectiveCacheSettings(config, 'author', 'google')).toMatchObject({ enabled: true, resultsTtlMs: config.resultsTtlSeconds * 1000 });
  });
});

describe('latestMarkerAt', () => {
  const markers: ClearMarker[] = [
    { at: '2026-01-01T00:00:00.000Z' },
    { namespace: 'book', provider: 'google', at: '2026-02-01T00:00:00.000Z' },
    { emptyOnly: true, at: '2026-03-01T00:00:00.000Z' },
  ];

  it('picks the newest marker whose scope covers the entry', () => {
    expect(latestMarkerAt(markers, 'book', 'google', 'results')).toBe(Date.parse('2026-02-01T00:00:00.000Z'));
    expect(latestMarkerAt(markers, 'book', 'google', 'empty')).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(latestMarkerAt(markers, 'author', 'audnexus', 'found')).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(latestMarkerAt([], 'book', 'google', 'results')).toBe(0);
  });
});
