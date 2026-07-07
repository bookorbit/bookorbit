import type { Mocked } from 'vitest';
import {
  ALL_METADATA_FIELDS,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
  ProviderConfigurations,
} from '@bookorbit/types';
import { of } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
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
  let providerConfig: Mocked<ProviderConfigService>;
  let resolver: Mocked<MetadataPreferenceResolver>;
  let registry: Mocked<ProviderRegistry>;
  let throttleTracker: Mocked<Pick<ProviderThrottleTracker, 'isThrottled'>>;
  let pipeline: MetadataFetchPipeline;

  beforeEach(() => {
    fetchService = {
      search: vi.fn(),
    } as unknown as Mocked<MetadataFetchService>;

    preferencesService = {
      getGlobal: vi.fn(),
      getForLibrary: vi.fn(),
    } as unknown as Mocked<MetadataPreferencesService>;

    providerConfig = {
      getConfig: vi.fn().mockResolvedValue(makeProviderConfig()),
    } as unknown as Mocked<ProviderConfigService>;

    resolver = {
      resolve: vi.fn(),
      withForwardCompatibility: vi.fn(),
    } as unknown as Mocked<MetadataPreferenceResolver>;

    registry = {
      all: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    throttleTracker = { isThrottled: vi.fn().mockReturnValue(false) };
    pipeline = new MetadataFetchPipeline(
      fetchService,
      preferencesService,
      resolver,
      registry,
      throttleTracker as ProviderThrottleTracker,
      providerConfig,
    );
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

  it('filters derived provider keys by enabled provider config', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.KOBO],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        google: { enabled: false, apiKey: '' },
        openLibrary: { enabled: false },
        kobo: { enabled: true, country: 'us', language: 'en' },
        lubimyczytac: { enabled: false },
      }),
    );
    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE },
      { key: MetadataProviderKey.OPEN_LIBRARY },
      { key: MetadataProviderKey.KOBO },
    ] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.KOBO, 'k1', { title: 'Kobo Title' })));

    await pipeline.run({ title: 'Query' }, {});

    expect(fetchService.search).toHaveBeenCalledWith({ title: 'Query' }, [MetadataProviderKey.KOBO]);
  });

  it('returns diagnostics when field rules only reference disabled providers', async () => {
    const global = createPreferences();

    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        google: { enabled: false, apiKey: '' },
        openLibrary: { enabled: false },
      }),
    );
    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE },
      { key: MetadataProviderKey.OPEN_LIBRARY },
      { key: MetadataProviderKey.KOBO },
    ] as never);

    const { resolved, diagnostics } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved).toEqual({});
    expect(fetchService.search).not.toHaveBeenCalled();
    expect(diagnostics).toMatchObject({
      reason: 'no_active_providers',
      activeProviders: [],
      fieldRuleProviders: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
      disabledFieldRuleProviders: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
      enabledUnreferencedProviders: [MetadataProviderKey.KOBO],
      throttledProviders: [],
      candidateProviders: [],
      candidateCount: 0,
      resolvedFieldCount: 0,
    });
  });

  it('returns diagnostics when selected providers are throttled', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    throttleTracker.isThrottled.mockReturnValue(true);

    const { diagnostics } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(fetchService.search).not.toHaveBeenCalled();
    expect(diagnostics.reason).toBe('providers_throttled');
    expect(diagnostics.throttledProviders).toEqual([MetadataProviderKey.GOOGLE]);
  });

  it('returns diagnostics when active providers return no candidates', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(of() as never);

    const { diagnostics } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(diagnostics.reason).toBe('no_candidates');
    expect(diagnostics.activeProviders).toEqual([MetadataProviderKey.GOOGLE]);
    expect(diagnostics.candidateCount).toBe(0);
  });

  it('returns diagnostics when candidates do not resolve any fields', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

    const { resolved, diagnostics } = await pipeline.runWithSources({ title: 'Query' }, { title: 'Existing Title' });

    expect(resolved).toEqual({});
    expect(diagnostics.reason).toBe('no_resolved_fields');
    expect(diagnostics.candidateProviders).toEqual([MetadataProviderKey.GOOGLE]);
    expect(diagnostics.candidateCount).toBe(1);
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

  it('resolves community ratings from every configured provider', async () => {
    const prefs = createPreferences((fields) => {
      for (const field of ALL_METADATA_FIELDS) {
        fields[field] = {
          enabled: false,
          providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'overwriteIfProvided',
        };
      }
      fields.communityRating = {
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
        candidate(MetadataProviderKey.GOOGLE, 'g1', { communityRating: 4.1 }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { communityRating: 4.2, communityRatingCount: 999 }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved).toMatchObject({
      communityRatings: [
        { provider: MetadataProviderKey.GOOGLE, rating: 4.1, ratingCount: null, updatedAt: expect.any(String) },
        { provider: MetadataProviderKey.OPEN_LIBRARY, rating: 4.2, ratingCount: 999, updatedAt: expect.any(String) },
      ],
    });
    expect(sources.communityRating).toBe(`${MetadataProviderKey.GOOGLE}|${MetadataProviderKey.OPEN_LIBRARY}`);
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
      genres: { mode: 'merge', blocklist: [] },
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

  it('filters blocklisted genres before merging selected providers', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'merge', blocklist: ['audiobook', ' Adult '] },
      saveProviderIds: false,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Sci-Fi', 'Audiobook', 'Adult'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['audiobook', 'Fantasy'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Sci-Fi', 'Fantasy']);
    expect(sources.genres).toBe(MetadataProviderKey.GOOGLE);
  });

  it('filters blocklisted genres and falls back in first-provider mode when a provider has no remaining genres', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: ['Audiobook'] },
      saveProviderIds: false,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['audiobook'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Fantasy', 'Adventure'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Fantasy', 'Adventure']);
    expect(sources.genres).toBe(MetadataProviderKey.OPEN_LIBRARY);
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
      genres: { mode: 'firstProvider', blocklist: [] },
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

  it('passes through Hardcover edition id with provider ids when saveProviderIds is enabled', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.HARDCOVER],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [] },
      saveProviderIds: true,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.HARDCOVER }] as never);
    fetchService.search.mockReturnValue(
      of(candidate(MetadataProviderKey.HARDCOVER, 'the-name-of-the-wind', { title: 'Fetched Title', hardcoverEditionId: '1001' })),
    );

    const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.hardcoverEditionId).toBe('1001');
    expect(providerIds).toEqual({ [MetadataProviderKey.HARDCOVER]: 'the-name-of-the-wind' });
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
      genres: { mode: 'firstProvider', blocklist: [] },
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

  it('does not pass through Hardcover edition id when provider id saving is disabled', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.HARDCOVER],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [] },
      saveProviderIds: false,
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.HARDCOVER }] as never);
    fetchService.search.mockReturnValue(
      of(candidate(MetadataProviderKey.HARDCOVER, 'the-name-of-the-wind', { title: 'Fetched Title', hardcoverEditionId: '1001' })),
    );

    const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.hardcoverEditionId).toBeUndefined();
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

  it('passes through series memberships when series name and index resolve from the same provider', async () => {
    const prefs = createPreferences((fields) => {
      fields.seriesName = {
        enabled: true,
        providers: [MetadataProviderKey.AUDIBLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.seriesIndex = {
        enabled: true,
        providers: [MetadataProviderKey.AUDIBLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.AUDIBLE }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: 11,
          seriesMemberships: [
            { seriesName: '  Sword   of Truth ', seriesIndex: 11 },
            { seriesName: 'sword of truth', seriesIndex: 12 },
            { seriesName: 'Chainfire\tTrilogy', seriesIndex: 3 },
          ],
        }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, {});

    expect(resolved.seriesName).toBe('Sword of Truth');
    expect(resolved.seriesIndex).toBe(11);
    expect(resolved.seriesMemberships).toEqual([
      { seriesName: 'Sword of Truth', seriesIndex: 11 },
      { seriesName: 'Chainfire Trilogy', seriesIndex: 3 },
    ]);
  });

  it('does not pass series memberships when series name and index resolve from different providers', async () => {
    const prefs = createPreferences((fields) => {
      fields.seriesName = {
        enabled: true,
        providers: [MetadataProviderKey.AUDIBLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.seriesIndex = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.AUDIBLE }, { key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: 11,
          seriesMemberships: [
            { seriesName: 'Sword of Truth', seriesIndex: 11 },
            { seriesName: 'Chainfire Trilogy', seriesIndex: 3 },
          ],
        }),
        candidate(MetadataProviderKey.GOOGLE, 'g1', { seriesIndex: 12 }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, {});

    expect(resolved.seriesName).toBe('Sword of Truth');
    expect(resolved.seriesIndex).toBe(12);
    expect(resolved.seriesMemberships).toBeUndefined();
  });

  it('does not pass series memberships when only the series name resolves', async () => {
    const prefs = createPreferences((fields) => {
      fields.seriesName = {
        enabled: true,
        providers: [MetadataProviderKey.AUDIBLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.seriesIndex = {
        enabled: false,
        providers: [MetadataProviderKey.AUDIBLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.AUDIBLE }] as never);
    fetchService.search.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: 11,
          seriesMemberships: [
            { seriesName: 'Sword of Truth', seriesIndex: 11 },
            { seriesName: 'Chainfire Trilogy', seriesIndex: 3 },
          ],
        }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, { seriesIndex: 99 });

    expect(resolved.seriesName).toBe('Sword of Truth');
    expect(resolved.seriesIndex).toBeUndefined();
    expect(resolved.seriesMemberships).toBeUndefined();
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

  it('returns effective provider keys from library overrides and enabled provider config', async () => {
    const global = createPreferences();
    const resolvedPrefs = createPreferences((fields) => {
      for (const field of ALL_METADATA_FIELDS) {
        fields[field] = {
          enabled: false,
          providers: [MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'overwriteIfProvided',
        };
      }
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.KOBO, MetadataProviderKey.COMICVINE, MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.KOBO],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        comicvine: { enabled: false, apiKey: '' },
      }),
    );
    preferencesService.getGlobal.mockResolvedValue(global);
    preferencesService.getForLibrary.mockResolvedValue({
      libraryId: 10,
      overrides: { title: resolvedPrefs.fields.title, authors: resolvedPrefs.fields.authors },
      effective: resolvedPrefs,
    });
    resolver.resolve.mockReturnValue(resolvedPrefs);
    resolver.withForwardCompatibility.mockReturnValue(resolvedPrefs);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE },
      { key: MetadataProviderKey.COMICVINE },
      { key: MetadataProviderKey.KOBO },
    ] as never);

    const result = await pipeline.getEffectiveProviderKeys(10);

    expect(preferencesService.getForLibrary).toHaveBeenCalledWith(10, global);
    expect(result).toEqual([MetadataProviderKey.KOBO, MetadataProviderKey.GOOGLE]);
  });
});

function makeProviderConfig(overrides: Partial<ProviderConfigurations> = {}): ProviderConfigurations {
  return {
    google: { enabled: true, apiKey: '', ...overrides.google },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '', ...overrides.amazon },
    goodreads: { enabled: true, ...overrides.goodreads },
    hardcover: { enabled: true, apiKey: 'hardcover-key', ...overrides.hardcover },
    openLibrary: { enabled: true, ...overrides.openLibrary },
    itunes: { enabled: true, coverResolution: 'high', ...overrides.itunes },
    audible: { enabled: true, domain: 'com', ...overrides.audible },
    audnexus: { enabled: true, ...overrides.audnexus },
    comicvine: { enabled: true, apiKey: 'comicvine-key', ...overrides.comicvine },
    ranobedb: { enabled: true, ...overrides.ranobedb },
    kobo: { enabled: true, country: 'us', language: 'en', ...overrides.kobo },
    lubimyczytac: { enabled: false, ...overrides.lubimyczytac },
    aladin: { enabled: false, ttbKey: '', ...overrides.aladin },
  };
}
