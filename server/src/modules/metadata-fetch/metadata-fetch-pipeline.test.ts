import type { Mocked } from 'vitest';
import {
  ALL_METADATA_FIELDS,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
} from '@projectx/types';
import { of } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

function createPreferences(mutate?: (fields: Record<MetadataField, FieldPreference>) => void): MetadataFetchPreferences {
  const fields = Object.fromEntries(
    ALL_METADATA_FIELDS.map((field) => [
      field,
      {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      } satisfies FieldPreference,
    ]),
  ) as Record<MetadataField, FieldPreference>;

  mutate?.(fields);
  return { fields };
}

function candidate(provider: MetadataProviderKey, providerId: string, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    provider,
    providerId,
    title: data.title ?? `${provider}-${providerId}`,
    ...data,
  };
}

describe('MetadataFetchPipeline', () => {
  let fetchService: Mocked<MetadataFetchService>;
  let preferencesService: Mocked<MetadataPreferencesService>;
  let resolver: Mocked<MetadataPreferenceResolver>;
  let registry: Mocked<ProviderRegistry>;
  let pipeline: MetadataFetchPipeline;

  beforeEach(() => {
    fetchService = {
      search: vi.fn(),
    } as unknown as Mocked<MetadataFetchService>;

    preferencesService = {
      getGlobal: vi.fn(),
      getForLibrary: vi.fn(),
    } as unknown as Mocked<MetadataPreferencesService>;

    resolver = {
      resolve: vi.fn(),
      withForwardCompatibility: vi.fn(),
    } as unknown as Mocked<MetadataPreferenceResolver>;

    registry = {
      all: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    const throttleTracker = { isThrottled: vi.fn().mockReturnValue(false) } as unknown as ProviderThrottleTracker;
    pipeline = new MetadataFetchPipeline(fetchService, preferencesService, resolver, registry, throttleTracker);
  });

  it('derives enabled provider keys from active fields, filters unknown providers, and de-duplicates keys', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.description = {
        enabled: false,
        providers: [MetadataProviderKey.AMAZON],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Title' })));

    await pipeline.run({ title: 'Query' }, {});

    expect(fetchService.search).toHaveBeenCalledWith({ title: 'Query' }, [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
  });

  it('applies fillMissing without overwriting existing fields and records sources', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      };
      fields.description = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', {
          title: 'Fetched Title',
          description: 'Fetched Description',
        }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { title: 'Existing Title' });

    expect(resolved.title).toBeUndefined();
    expect(resolved.description).toBe('Fetched Description');
    expect(sources.title).toBeUndefined();
    expect(sources.description).toBe(MetadataProviderKey.GOOGLE);
  });

  it('falls back to the next provider in order when the first provider does not provide the requested field', async () => {
    const prefs = createPreferences((fields) => {
      fields.description = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { description: undefined }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { description: 'OpenLibrary Description' }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.description).toBe('OpenLibrary Description');
    expect(sources.description).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('maps cover field to coverUrl output and source key', async () => {
    const prefs = createPreferences((fields) => {
      fields.cover = {
        enabled: true,
        providers: [MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { coverUrl: 'https://img.example/cover.jpg' })));

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.coverUrl).toBe('https://img.example/cover.jpg');
    expect(sources.coverUrl).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('passes through comic metadata from the preferred provider', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.COMICVINE, MetadataProviderKey.AMAZON],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.seriesName = {
        enabled: true,
        providers: [MetadataProviderKey.COMICVINE, MetadataProviderKey.AMAZON],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.COMICVINE }, { key: MetadataProviderKey.AMAZON }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.COMICVINE, 'cv1', {
          comicMetadata: {
            issueNumber: '12',
            volumeName: 'Arkham Asylum',
            pencillers: ['Jock'],
          },
        }),
      ),
    );

    const { resolved } = await pipeline.runWithSources({ title: 'Arkham Asylum #12' }, {});

    expect(resolved.comicMetadata).toEqual({
      issueNumber: '12',
      volumeName: 'Arkham Asylum',
      pencillers: ['Jock'],
    });
  });

  it('merges genres from selected providers when genre merge mode is enabled', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'merge' },
      saveProviderIds: false,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Sci-Fi', 'Space Opera'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Sci-Fi', 'Classic'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Sci-Fi', 'Space Opera', 'Classic']);
    expect(sources.genres).toBe(MetadataProviderKey.GOOGLE);
  });

  it('returns provider ids for matched providers when saveProviderIds is enabled', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider' },
      saveProviderIds: true,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

    const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Query' }, { title: 'Existing Title' });

    expect(resolved.title).toBeUndefined();
    expect(providerIds).toEqual({ [MetadataProviderKey.GOOGLE]: 'g1' });
  });

  it('does not return provider ids when saveProviderIds is disabled', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider' },
      saveProviderIds: false,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

    const { providerIds } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(providerIds).toEqual({});
  });

  it('keeps the first candidate from each provider to avoid provider stream reordering issues', async () => {
    const prefs = createPreferences((fields) => {
      fields.description = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g-first', { description: 'First description' }),
        candidate(MetadataProviderKey.GOOGLE, 'g-second', { description: 'Second description' }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Query' }, {});

    expect(resolved.description).toBe('First description');
  });

  it('loads and applies library overrides when libraryId is provided', async () => {
    const global = createPreferences();
    const resolvedPrefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(global);
    preferencesService.getForLibrary.mockResolvedValue({
      libraryId: 10,
      overrides: { title: resolvedPrefs.fields.title },
      effective: resolvedPrefs,
    });
    resolver.resolve.mockReturnValue(resolvedPrefs);
    resolver.withForwardCompatibility.mockReturnValue(resolvedPrefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { title: 'Library Title' })));

    const result = await pipeline.run({ title: 'Query' }, {}, 10);

    expect(preferencesService.getForLibrary).toHaveBeenCalledWith(10, global);
    expect(result.title).toBe('Library Title');
  });
});
