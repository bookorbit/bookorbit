import type { Mocked } from 'vitest';
import {
  ALL_METADATA_FIELDS,
  CoverMedia,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchPreferences,
  MetadataField,
  MetadataProviderKey,
  ProviderConfigurations,
} from '@bookorbit/types';
import { of } from 'rxjs';

import { SeriesExpectedCountService } from '../../common/services/series-expected-count.service';
import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import type { MetadataProvider } from './providers/metadata-provider';
import type { MetadataSearchParams } from './providers/metadata-search-params';

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

const PROVIDER_TRAITS: Partial<Record<MetadataProviderKey, Partial<MetadataProvider>>> = {
  [MetadataProviderKey.AUDIBLE]: { mediaKinds: ['audiobook'], coverShape: 'square' },
  [MetadataProviderKey.AUDNEXUS]: { mediaKinds: ['audiobook'], coverShape: 'square' },
  [MetadataProviderKey.LIBROFM]: { mediaKinds: ['audiobook'], coverShape: 'square' },
  [MetadataProviderKey.COMICVINE]: { mediaKinds: ['comic'], coverShape: 'portrait' },
  [MetadataProviderKey.ITUNES]: { editionFollowsMedium: true },
  [MetadataProviderKey.HARDCOVER]: { editionFollowsMedium: true },
};

// Candidates share a title by default so that fixtures exercising field-rule precedence describe
// one book. Cross-provider agreement drops candidates that describe a different book, which is a
// separate concern with its own tests.
const SHARED_CANDIDATE_TITLE = 'Shared Candidate Book';

function candidate(provider: MetadataProviderKey, providerId: string, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    provider,
    providerId,
    title: data.title ?? SHARED_CANDIDATE_TITLE,
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
  let seriesExpectedCount: Mocked<Pick<SeriesExpectedCountService, 'recordFromCandidates'>>;
  let pipeline: MetadataFetchPipeline;

  beforeEach(() => {
    fetchService = {
      searchCandidates: vi.fn(),
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

    // The media helpers run the real registry over whatever providers a test registers, with each
    // provider's real media and edition traits.
    const live = () =>
      new ProviderRegistry(((registry.all() ?? []) as MetadataProvider[]).map((provider) => ({ ...PROVIDER_TRAITS[provider.key], ...provider })));
    registry = {
      all: vi.fn(),
      keysForMedia: vi.fn((keys: MetadataProviderKey[], media: CoverMedia) => live().keysForMedia(keys, media)),
      servesOnlyAudiobooks: vi.fn((key: MetadataProviderKey) => live().servesOnlyAudiobooks(key)),
      editionFollowsMedium: vi.fn((key: MetadataProviderKey) => live().editionFollowsMedium(key)),
    } as unknown as Mocked<ProviderRegistry>;

    throttleTracker = { isThrottled: vi.fn().mockReturnValue(false) };
    seriesExpectedCount = { recordFromCandidates: vi.fn().mockResolvedValue(0) };
    pipeline = new MetadataFetchPipeline(
      fetchService,
      preferencesService,
      resolver,
      registry,
      throttleTracker as ProviderThrottleTracker,
      providerConfig,
      seriesExpectedCount as unknown as SeriesExpectedCountService,
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
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Title' })));

    await pipeline.run({ title: 'Query' }, {});

    expect(fetchService.searchCandidates).toHaveBeenCalledWith({ title: 'Query' }, [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
  });

  it('restricts established-book refreshes to providers with stored ids in existing-only mode', async () => {
    const preferences = createPreferences();
    preferences.options = {
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'existingOnly',
    };
    preferencesService.getGlobal.mockResolvedValue(preferences);
    resolver.resolve.mockReturnValue(preferences);
    resolver.withForwardCompatibility.mockReturnValue(preferences);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'stored-google', { title: 'Fetched Title' })));

    const params = {
      title: 'Query',
      existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-google' },
    };
    const { resolved } = await pipeline.runWithSources(params, {});

    expect(resolved.title).toBe('Fetched Title');
    expect(fetchService.searchCandidates).toHaveBeenCalledWith({ ...params, existingProviderIdsOnly: true }, [MetadataProviderKey.GOOGLE]);
  });

  it('reports when existing-only mode has no stored ids for active field-rule providers', async () => {
    const preferences = createPreferences();
    preferences.options = {
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'existingOnly',
    };
    preferencesService.getGlobal.mockResolvedValue(preferences);
    resolver.resolve.mockReturnValue(preferences);
    resolver.withForwardCompatibility.mockReturnValue(preferences);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);

    const { diagnostics, resolved } = await pipeline.runWithSources({ title: 'Query', existingProviderIds: {} }, {});

    expect(resolved).toEqual({});
    expect(diagnostics.reason).toBe('no_existing_provider_ids');
    expect(diagnostics.activeProviders).toEqual([]);
    expect(fetchService.searchCandidates).not.toHaveBeenCalled();
  });

  it('lets AudNexus refresh through an existing Audible id in existing-only mode', async () => {
    const preferences = createPreferences((fields) => {
      for (const field of ALL_METADATA_FIELDS) fields[field].providers = [MetadataProviderKey.AUDNEXUS];
    });
    preferences.options = {
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'existingOnly',
    };
    preferencesService.getGlobal.mockResolvedValue(preferences);
    resolver.resolve.mockReturnValue(preferences);
    resolver.withForwardCompatibility.mockReturnValue(preferences);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.AUDNEXUS }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.AUDNEXUS, 'B0EXISTING', { title: 'Audio Title' })));

    const params = {
      title: 'Audio Title',
      existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0EXISTING' },
      isAudiobook: true,
    };
    await pipeline.run(params, {});

    expect(fetchService.searchCandidates).toHaveBeenCalledWith({ ...params, existingProviderIdsOnly: true, includeAudiobookProviders: true }, [
      MetadataProviderKey.AUDNEXUS,
    ]);
  });

  it('keeps identity discovery enabled when strict preferences are used outside an established-book refresh', async () => {
    const preferences = createPreferences();
    preferences.options = {
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'existingOnly',
    };
    preferencesService.getGlobal.mockResolvedValue(preferences);
    resolver.resolve.mockReturnValue(preferences);
    resolver.withForwardCompatibility.mockReturnValue(preferences);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'new-google', { title: 'Discovered Title' })));

    const resolved = await pipeline.run({ title: 'Query' }, {});

    expect(resolved.title).toBe('Discovered Title');
    expect(fetchService.searchCandidates).toHaveBeenCalledWith({ title: 'Query' }, [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
  });

  describe('series expected counts', () => {
    function primePreferences() {
      const global = createPreferences();
      preferencesService.getGlobal.mockResolvedValue(global);
      resolver.resolve.mockReturnValue(global);
      resolver.withForwardCompatibility.mockReturnValue(global);
      registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    }

    it('forwards every candidate, not just the one that wins field resolution', async () => {
      primePreferences();
      fetchService.searchCandidates.mockReturnValue(
        of(
          candidate(MetadataProviderKey.GOOGLE, 'g1', { seriesName: 'Dune', seriesTotalBooks: 6 }),
          candidate(MetadataProviderKey.OPEN_LIBRARY, 'o1', { seriesName: 'Dune', seriesTotalBooks: 8 }),
        ),
      );

      await pipeline.run({ title: 'Query' }, {});

      expect(seriesExpectedCount.recordFromCandidates).toHaveBeenCalledTimes(1);
      expect(seriesExpectedCount.recordFromCandidates).toHaveBeenCalledWith([
        expect.objectContaining({ providerId: 'g1', seriesTotalBooks: 6 }),
        expect.objectContaining({ providerId: 'o1', seriesTotalBooks: 8 }),
      ]);
    });

    it('still resolves fields when recording the totals fails', async () => {
      primePreferences();
      seriesExpectedCount.recordFromCandidates.mockRejectedValueOnce(new Error('unreachable'));
      fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

      const resolved = await pipeline.run({ title: 'Query' }, {});

      expect(resolved.title).toBe('Fetched Title');
    });
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
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.KOBO, 'k1', { title: 'Kobo Title' })));

    await pipeline.run({ title: 'Query' }, {});

    expect(fetchService.searchCandidates).toHaveBeenCalledWith({ title: 'Query' }, [MetadataProviderKey.KOBO]);
  });

  it('keeps an audiobook-only provider out of a book without audio, even when a Field Rule names it', async () => {
    const global = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.LIBROFM, MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        librofm: { enabled: true },
      }),
    );
    preferencesService.getGlobal.mockResolvedValue(global);
    resolver.resolve.mockReturnValue(global);
    resolver.withForwardCompatibility.mockReturnValue(global);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.LIBROFM }, { key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Yesteryear' })));

    const params = { title: 'Yesteryear', author: 'Caro Claire Burke', isbn: '9780593804223', isAudiobook: false };
    const { diagnostics } = await pipeline.runWithSources(params, {}, undefined, { coverMedia: { hasEbook: true, hasAudio: false } });

    expect(fetchService.searchCandidates).toHaveBeenCalledTimes(1);
    expect(fetchService.searchCandidates).toHaveBeenCalledWith(params, [MetadataProviderKey.GOOGLE]);
    expect(diagnostics.fieldRuleProviders).not.toContain(MetadataProviderKey.LIBROFM);
    expect(diagnostics.enabledUnreferencedProviders).not.toContain(MetadataProviderKey.LIBROFM);
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
    expect(fetchService.searchCandidates).not.toHaveBeenCalled();
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

    expect(fetchService.searchCandidates).not.toHaveBeenCalled();
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
    fetchService.searchCandidates.mockReturnValue(of() as never);

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
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

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
    fetchService.searchCandidates.mockReturnValue(
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

  describe('cross-provider agreement', () => {
    function primeAgreementPreferences() {
      const prefs = createPreferences((fields) => {
        fields.title = {
          enabled: true,
          providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
        fields.subtitle = {
          enabled: true,
          providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
        fields.authors = {
          enabled: true,
          providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
        fields.publisher = {
          enabled: true,
          providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
        fields.cover = {
          enabled: true,
          providers: [MetadataProviderKey.AMAZON, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
        fields.pageCount = {
          enabled: true,
          providers: [MetadataProviderKey.AMAZON, MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwriteIfProvided',
        };
      });

      preferencesService.getGlobal.mockResolvedValue(prefs);
      resolver.resolve.mockReturnValue(prefs);
      resolver.withForwardCompatibility.mockReturnValue(prefs);
      registry.all.mockReturnValue([
        { key: MetadataProviderKey.GOODREADS },
        { key: MetadataProviderKey.GOOGLE },
        { key: MetadataProviderKey.AMAZON },
      ] as never);
    }

    it('never assembles one record out of candidates describing different books', async () => {
      primeAgreementPreferences();
      fetchService.searchCandidates.mockReturnValue(
        of(
          candidate(MetadataProviderKey.GOODREADS, 'gr1', {
            title: 'The Girl on the Train',
            subtitle: 'A Novel of Suspense',
            authors: ['Paula Hawkins'],
            publisher: 'Riverhead Books',
          }),
          candidate(MetadataProviderKey.AMAZON, 'az1', {
            title: 'The Hobbit Cookbook',
            authors: ['Some Chef'],
            coverUrl: 'https://example.com/wrong-cover.jpg',
            pageCount: 120,
          }),
          candidate(MetadataProviderKey.GOOGLE, 'gg1', {
            title: 'The Hobbit',
            authors: ['J.R.R. Tolkien'],
            publisher: 'George Allen & Unwin',
            coverUrl: 'https://example.com/correct-cover.jpg',
          }),
        ),
      );

      const { resolved, sources, diagnostics } = await pipeline.runWithSources({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, {});

      expect(resolved.title).toBe('The Hobbit');
      expect(resolved.authors).toEqual(['J.R.R. Tolkien']);
      expect(resolved.publisher).toBe('George Allen & Unwin');
      expect(resolved.coverUrl).toBe('https://example.com/correct-cover.jpg');
      expect(resolved.subtitle).toBeUndefined();
      expect(resolved.pageCount).toBeUndefined();
      expect(new Set(Object.values(sources))).toEqual(new Set([MetadataProviderKey.GOOGLE]));
      expect(diagnostics.candidateProviders).toEqual([MetadataProviderKey.GOOGLE]);
    });

    it('reports no candidates when every provider matched a different book', async () => {
      primeAgreementPreferences();
      fetchService.searchCandidates.mockReturnValue(
        of(
          candidate(MetadataProviderKey.GOODREADS, 'gr1', { title: 'The Girl on the Train', authors: ['Paula Hawkins'] }),
          candidate(MetadataProviderKey.AMAZON, 'az1', { title: 'The Silence of the Lambs', authors: ['Thomas Harris'] }),
        ),
      );

      const { resolved, diagnostics } = await pipeline.runWithSources({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, {});

      // The most trusted provider anchors, so its own record still applies; the unrelated one does not.
      expect(resolved.title).toBe('The Girl on the Train');
      expect(diagnostics.candidateProviders).toEqual([MetadataProviderKey.GOODREADS]);
      expect(diagnostics.candidateCount).toBe(1);
    });

    it('still fills a field from a lower-priority provider that agrees on the book', async () => {
      primeAgreementPreferences();
      fetchService.searchCandidates.mockReturnValue(
        of(
          candidate(MetadataProviderKey.GOODREADS, 'gr1', { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] }),
          candidate(MetadataProviderKey.AMAZON, 'az1', {
            title: 'The Hobbit: Or There and Back Again',
            authors: ['J. R. R. Tolkien'],
            coverUrl: 'https://example.com/cover.jpg',
            pageCount: 310,
          }),
        ),
      );

      const { resolved, sources } = await pipeline.runWithSources({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, {});

      expect(resolved.title).toBe('The Hobbit');
      expect(resolved.coverUrl).toBe('https://example.com/cover.jpg');
      expect(resolved.pageCount).toBe(310);
      expect(sources.coverUrl).toBe(MetadataProviderKey.AMAZON);
    });

    it('does not store provider ids for candidates describing a different book', async () => {
      const prefs = createPreferences((fields) => {
        fields.title = {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.GOODREADS],
          mergeStrategy: 'overwriteIfProvided',
        };
      });
      prefs.options = {
        genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
        saveProviderIds: true,
        providerIdMode: 'preferExisting',
      };
      preferencesService.getGlobal.mockResolvedValue(prefs);
      resolver.resolve.mockReturnValue(prefs);
      resolver.withForwardCompatibility.mockReturnValue(prefs);
      registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.GOODREADS }] as never);
      fetchService.searchCandidates.mockReturnValue(
        of(
          candidate(MetadataProviderKey.GOOGLE, 'gg1', { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] }),
          candidate(MetadataProviderKey.GOODREADS, 'gr1', { title: 'The Girl on the Train', authors: ['Paula Hawkins'] }),
        ),
      );

      const { providerIds } = await pipeline.runWithSources({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, {});

      expect(providerIds[MetadataProviderKey.GOOGLE]).toBe('gg1');
      expect(providerIds[MetadataProviderKey.GOODREADS]).toBeUndefined();
    });

    it('leaves a single provider untouched, having nothing to disagree with', async () => {
      primeAgreementPreferences();
      fetchService.searchCandidates.mockReturnValue(
        of(candidate(MetadataProviderKey.GOODREADS, 'gr1', { title: 'A Loosely Matching Title', authors: ['Someone'] })),
      );

      const { resolved } = await pipeline.runWithSources({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, {});

      expect(resolved.title).toBe('A Loosely Matching Title');
    });
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { description: undefined }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { description: 'OpenLibrary Description' }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.description).toBe('OpenLibrary Description');
    expect(sources.description).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('treats an empty array as not provided and falls back under overwriteIfProvided', async () => {
    const prefs = createPreferences((fields) => {
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { authors: [] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { authors: ['Fallback Author'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { authors: ['Existing Author'] });

    expect(resolved.authors).toEqual(['Fallback Author']);
    expect(sources.authors).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('does not clear an existing array when overwriteIfProvided providers return empty arrays', async () => {
    const prefs = createPreferences((fields) => {
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(candidate(MetadataProviderKey.GOOGLE, 'g1', { authors: [] }), candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { authors: [] })),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { authors: ['Existing Author'] });

    expect(resolved.authors).toBeUndefined();
    expect(sources.authors).toBeUndefined();
  });

  it('falls back from an empty array under fillMissing when the existing field is empty', async () => {
    const prefs = createPreferences((fields) => {
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'fillMissing',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { authors: [] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { authors: ['Fallback Author'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { authors: [] });

    expect(resolved.authors).toEqual(['Fallback Author']);
    expect(sources.authors).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('treats a blank string as not provided and falls back under overwriteIfProvided', async () => {
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { description: '   ' }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { description: 'Fallback Description' }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { description: 'Existing Description' });

    expect(resolved.description).toBe('Fallback Description');
    expect(sources.description).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('preserves empty arrays as explicit clears under overwrite', async () => {
    const prefs = createPreferences((fields) => {
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwrite',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { authors: [] })));

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { authors: ['Existing Author'] });

    expect(resolved.authors).toEqual([]);
    expect(sources.authors).toBe(MetadataProviderKey.GOOGLE);
  });

  it('keeps zero and false provider values under overwriteIfProvided', async () => {
    const prefs = createPreferences((fields) => {
      fields.duration = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.abridged = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { durationSeconds: 0, abridged: false })));

    const { resolved } = await pipeline.runWithSources({ title: 'Query' }, { duration: 60, abridged: true });

    expect(resolved.duration).toBe(0);
    expect(resolved.abridged).toBe(false);
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
    fetchService.searchCandidates.mockReturnValue(
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
    fetchService.searchCandidates.mockReturnValue(
      of(candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { coverUrl: 'https://img.example/cover.jpg' })),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.coverUrl).toBe('https://img.example/cover.jpg');
    expect(sources.coverUrl).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('does not replace an existing cover when the field rule is fillMissing', async () => {
    const prefs = createPreferences((fields) => {
      fields.cover = {
        enabled: true,
        providers: [MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'fillMissing',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { coverUrl: 'https://img.example/cover.jpg' })),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { cover: 'extracted' });

    expect(resolved.coverUrl).toBeUndefined();
    expect(sources.coverUrl).toBeUndefined();
  });

  it('preserves imported metadata while filling missing values during event-import enrichment', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.authors = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.description = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.cover = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', {
          title: 'Provider Title',
          authors: ['Provider Author'],
          description: 'Provider Description',
          genres: ['Provider Genre'],
          coverUrl: 'https://img.example/provider-cover.jpg',
        }),
      ),
    );

    const { resolved } = await pipeline.runWithSources(
      { title: 'File Title' },
      {
        title: 'File Title',
        authors: ['File Author'],
        description: null,
        genres: ['File Genre'],
        cover: 'extracted',
      },
      undefined,
      { preserveExisting: true },
    );

    expect(resolved).toMatchObject({ description: 'Provider Description' });
    expect(resolved.title).toBeUndefined();
    expect(resolved.authors).toBeUndefined();
    expect(resolved.genres).toBeUndefined();
    expect(resolved.coverUrl).toBeUndefined();
  });

  it('preserves populated ComicInfo fields while filling missing comic metadata during event-import enrichment', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.COMICVINE],
        mergeStrategy: 'overwriteIfProvided',
      };
      fields.seriesName = {
        enabled: true,
        providers: [MetadataProviderKey.COMICVINE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.COMICVINE }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.COMICVINE, 'cv1', {
          comicMetadata: {
            issueNumber: '99',
            volumeName: 'Provider Volume',
            pencillers: ['Provider Penciller'],
          },
        }),
      ),
    );

    const { resolved } = await pipeline.runWithSources(
      { title: 'Akira' },
      {
        comicMetadata: {
          issueNumber: '28',
          volumeName: null,
          pencillers: ['Katsuhiro Otomo'],
        },
      },
      undefined,
      { preserveExisting: true },
    );

    expect(resolved.comicMetadata).toEqual({ volumeName: 'Provider Volume' });
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
    fetchService.searchCandidates.mockReturnValue(
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
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Sci-Fi', 'Space Opera'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Sci-Fi', 'Classic'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Sci-Fi', 'Space Opera', 'Classic']);
    expect(sources.genres).toBe(MetadataProviderKey.GOOGLE);
  });

  it('merges fetched genres into stored genres without changing stored spelling or order', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'mergeExisting',
      };
    });
    prefs.options = {
      genres: { mode: 'merge', blocklist: [], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['romance', 'Magic'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Dark Academia', 'MAGIC'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources(
      { title: 'Query' },
      { genres: ['Romance', 'Literary Fiction', 'Contemporary', 'Fantasy'] },
    );

    expect(resolved.genres).toEqual(['Romance', 'Literary Fiction', 'Contemporary', 'Fantasy', 'Magic', 'Dark Academia']);
    expect(sources.genres).toBe(MetadataProviderKey.GOOGLE);
  });

  it('preserves stored blocklisted genres and limits only new merged additions', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'mergeExisting',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: ['Adult'], maxCount: 3 },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Adult', 'Fantasy', 'Mystery', 'Classic'] })),
    );

    const { resolved } = await pipeline.runWithSources({ title: 'Query' }, { genres: ['Adult', 'Romance'] });

    expect(resolved.genres).toEqual(['Adult', 'Romance', 'Fantasy']);
  });

  it('does not write genres when merge-with-existing finds no new values', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'mergeExisting',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['romance', 'FANTASY'] })));

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, { genres: ['Romance', 'Fantasy'] });

    expect(resolved.genres).toBeUndefined();
    expect(sources.genres).toBeUndefined();
  });

  it('does not trim stored genres when they already exceed the configured maximum', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'mergeExisting',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [], maxCount: 2 },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['New Genre'] })));

    const { resolved } = await pipeline.runWithSources({ title: 'Query' }, { genres: ['One', 'Two', 'Three'] });

    expect(resolved.genres).toBeUndefined();
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
      genres: { mode: 'merge', blocklist: ['audiobook', ' Adult '], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Sci-Fi', 'Audiobook', 'Adult'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['audiobook', 'Fantasy'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Sci-Fi', 'Fantasy']);
    expect(sources.genres).toBe(MetadataProviderKey.GOOGLE);
  });

  it('limits merged genres after exclusions and case-insensitive de-duplication', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'merge', blocklist: ['Adult'], maxCount: 3 },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Fiction', 'Fantasy', 'fantasy', 'Adult'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['fiction', 'Mystery', 'Classic'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Fiction', 'Fantasy', 'Mystery']);
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
      genres: { mode: 'firstProvider', blocklist: ['Audiobook'], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['audiobook'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Fantasy', 'Adventure'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Fantasy', 'Adventure']);
    expect(sources.genres).toBe(MetadataProviderKey.OPEN_LIBRARY);
  });

  it('limits genres from the selected provider in first-provider mode', async () => {
    const prefs = createPreferences((fields) => {
      fields.genres = {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [], maxCount: 2 },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }, { key: MetadataProviderKey.OPEN_LIBRARY }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g1', { genres: ['Fantasy', 'Adventure', 'Epic'] }),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { genres: ['Classic'] }),
      ),
    );

    const { resolved, sources } = await pipeline.runWithSources({ title: 'Query' }, {});

    expect(resolved.genres).toEqual(['Fantasy', 'Adventure']);
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
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

    const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Query' }, { title: 'Existing Title' });

    expect(resolved.title).toBeUndefined();
    expect(providerIds).toEqual({ [MetadataProviderKey.GOOGLE]: 'g1' });
  });

  it('stores an AudNexus ASIN as the Audible provider id', async () => {
    const prefs = createPreferences((fields) => {
      fields.title = {
        enabled: true,
        providers: [MetadataProviderKey.AUDNEXUS],
        mergeStrategy: 'overwriteIfProvided',
      };
    });
    prefs.options = {
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.AUDNEXUS }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDNEXUS, 'B0TEST12345', {
          audibleId: 'B0TEST12345',
          title: 'Fetched Audiobook',
        }),
      ),
    );

    const { providerIds } = await pipeline.runWithSources({ title: 'Query', isAudiobook: true }, {});

    expect(providerIds).toEqual({ [MetadataProviderKey.AUDIBLE]: 'B0TEST12345' });
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
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: true,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.HARDCOVER }] as never);
    fetchService.searchCandidates.mockReturnValue(
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
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.GOOGLE, 'g1', { title: 'Fetched Title' })));

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
      genres: { mode: 'firstProvider', blocklist: [], maxCount: null },
      saveProviderIds: false,
      providerIdMode: 'preferExisting',
    };

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.HARDCOVER }] as never);
    fetchService.searchCandidates.mockReturnValue(
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOOGLE, 'g-first', { description: 'First description' }),
        candidate(MetadataProviderKey.GOOGLE, 'g-second', { description: 'Second description' }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Query' }, {});

    expect(resolved.description).toBe('First description');
  });

  // A WAF-blocked Goodreads detail page used to leave the goodreads-first description rule holding
  // the ellipsised autocomplete snippet, which then overwrote a full description from further down
  // the provider order.
  it('falls through to the next provider when the leading provider yields no description', async () => {
    const prefs = createPreferences((fields) => {
      fields.description = {
        enabled: true,
        providers: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
        mergeStrategy: 'overwriteIfProvided',
      };
    });

    preferencesService.getGlobal.mockResolvedValue(prefs);
    resolver.resolve.mockReturnValue(prefs);
    resolver.withForwardCompatibility.mockReturnValue(prefs);
    registry.all.mockReturnValue([{ key: MetadataProviderKey.GOODREADS }, { key: MetadataProviderKey.GOOGLE }] as never);
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.GOODREADS, 'gr1', { pageCount: 404 }),
        candidate(MetadataProviderKey.GOOGLE, 'g1', { description: 'The whole blurb, all the way to the end.' }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Query' }, {});

    expect(resolved.description).toBe('The whole blurb, all the way to the end.');
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: '11',
          seriesMemberships: [
            { seriesName: '  Sword   of Truth ', seriesIndex: '11' },
            { seriesName: 'sword of truth', seriesIndex: '12' },
            { seriesName: 'Chainfire\tTrilogy', seriesIndex: '3' },
          ],
        }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, {});

    expect(resolved.seriesName).toBe('Sword of Truth');
    expect(resolved.seriesIndex).toBe('11');
    expect(resolved.seriesMemberships).toEqual([
      { seriesName: 'Sword of Truth', seriesIndex: '11' },
      { seriesName: 'Chainfire Trilogy', seriesIndex: '3' },
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: '11',
          seriesMemberships: [
            { seriesName: 'Sword of Truth', seriesIndex: '11' },
            { seriesName: 'Chainfire Trilogy', seriesIndex: '3' },
          ],
        }),
        candidate(MetadataProviderKey.GOOGLE, 'g1', { seriesIndex: '12' }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, {});

    expect(resolved.seriesName).toBe('Sword of Truth');
    expect(resolved.seriesIndex).toBe('12');
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
    fetchService.searchCandidates.mockReturnValue(
      of(
        candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', {
          seriesName: 'Sword of Truth',
          seriesIndex: '11',
          seriesMemberships: [
            { seriesName: 'Sword of Truth', seriesIndex: '11' },
            { seriesName: 'Chainfire Trilogy', seriesIndex: '3' },
          ],
        }),
      ),
    );

    const resolved = await pipeline.run({ title: 'Confessor', isAudiobook: true }, { seriesIndex: '99' });

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
    fetchService.searchCandidates.mockReturnValue(of(candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', { title: 'Library Title' })));

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

  describe('cover slots', () => {
    const EBOOK_ONLY: CoverMedia = { hasEbook: true, hasAudio: false };
    const AUDIO_ONLY: CoverMedia = { hasEbook: false, hasAudio: true };
    const BOTH: CoverMedia = { hasEbook: true, hasAudio: true };
    type Editions = { ebook?: Partial<MetadataCandidate>; audio?: Partial<MetadataCandidate> };

    function usePreferences(mutate?: (preferences: MetadataFetchPreferences) => void): MetadataFetchPreferences {
      const preferences = new MetadataPreferenceResolver().getDefaultPreferences();
      mutate?.(preferences);
      preferencesService.getGlobal.mockResolvedValue(preferences);
      resolver.resolve.mockReturnValue(preferences);
      resolver.withForwardCompatibility.mockReturnValue(preferences);
      return preferences;
    }

    function register(...keys: MetadataProviderKey[]): void {
      registry.all.mockReturnValue(keys.map((key) => ({ key })) as never);
    }

    /** Answers every search from a table, giving each provider's edition for the medium asked about. */
    function answer(table: Partial<Record<MetadataProviderKey, Editions>>): void {
      fetchService.searchCandidates.mockImplementation((params: MetadataSearchParams, providers?: MetadataProviderKey[]) =>
        of(
          ...(providers ?? []).flatMap((provider) => {
            const data = table[provider]?.[params.isAudiobook ? 'audio' : 'ebook'];
            return data ? [candidate(provider, `${provider}-${params.isAudiobook ? 'audio' : 'ebook'}`, data)] : [];
          }),
        ),
      );
    }

    function searches(): { params: MetadataSearchParams; providers: MetadataProviderKey[] }[] {
      return fetchService.searchCandidates.mock.calls.map(([params, providers]) => ({ params, providers: providers ?? [] }));
    }

    const square = (url: string): Partial<MetadataCandidate> => ({ coverUrl: url, coverShape: 'square' });
    const portrait = (url: string): Partial<MetadataCandidate> => ({ coverUrl: url, coverShape: 'portrait' });

    it('never asks an audiobook provider about a book without audio, even with a stored Audible id', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE, MetadataProviderKey.LIBROFM);
      answer({ [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') } });

      const { resolved } = await pipeline.runWithSources(
        { title: 'Dune', isAudiobook: false, existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0STORED' } },
        {},
        undefined,
        { coverMedia: EBOOK_ONLY },
      );

      expect(searches()).toHaveLength(1);
      expect(searches()[0]!.providers).not.toContain(MetadataProviderKey.AUDIBLE);
      expect(searches()[0]!.providers).not.toContain(MetadataProviderKey.LIBROFM);
      expect(searches()[0]!.params.includeAudiobookProviders).toBeUndefined();
      expect(resolved.coverUrl).toBe('https://google/e.jpg');
      expect(resolved.audioCoverUrl).toBeUndefined();
    });

    it('fills the audio slot of an audiobook in one pass, Audible first', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.AUDIBLE]: { audio: square('https://audible/a.jpg') },
        [MetadataProviderKey.ITUNES]: { audio: square('https://itunes/a.jpg') },
        [MetadataProviderKey.GOOGLE]: { audio: portrait('https://google/a.jpg') },
      });

      const { resolved, sources, diagnostics } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: true }, {}, undefined, {
        coverMedia: AUDIO_ONLY,
      });

      expect(searches()).toHaveLength(1);
      expect(searches()[0]!.params.includeAudiobookProviders).toBe(true);
      expect(resolved.coverUrl).toBeUndefined();
      expect(resolved.audioCoverUrl).toBe('https://audible/a.jpg');
      expect(resolved.audioCoverChoices?.map((choice) => [choice.provider, choice.fit])).toEqual([
        [MetadataProviderKey.AUDIBLE, 'match'],
        [MetadataProviderKey.ITUNES, 'match'],
        [MetadataProviderKey.GOOGLE, 'mismatch'],
      ]);
      expect(sources.audioCoverUrl).toBe(MetadataProviderKey.AUDIBLE);
      expect(diagnostics.coverSlots).toEqual({ audio: { provider: MetadataProviderKey.AUDIBLE, pass: 1 } });
    });

    it('asks only the edition-aware providers again, as the other medium and without the ids naming the first edition', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AMAZON);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') },
        [MetadataProviderKey.AMAZON]: { ebook: portrait('https://amazon/e.jpg') },
        [MetadataProviderKey.ITUNES]: { ebook: portrait('https://itunes/e.jpg'), audio: square('https://itunes/a.jpg') },
      });

      const { resolved, diagnostics } = await pipeline.runWithSources(
        {
          title: 'Dune',
          isbn: '9780441013593',
          hardcoverEditionId: '42',
          isAudiobook: false,
          existingProviderIds: { [MetadataProviderKey.ITUNES]: 'itunes-ebook', [MetadataProviderKey.GOOGLE]: 'g1' },
        },
        { cover: null, audioCover: null },
        undefined,
        { coverMedia: BOTH },
      );

      expect(searches()).toHaveLength(2);
      const pass2 = searches()[1]!;
      expect(pass2.providers).toEqual([MetadataProviderKey.ITUNES]);
      expect(pass2.params).toMatchObject({ title: 'Dune', isAudiobook: true, includeAudiobookProviders: false });
      expect(pass2.params.isbn).toBeUndefined();
      expect(pass2.params.hardcoverEditionId).toBeUndefined();
      expect(pass2.params.existingProviderIds).toEqual({ [MetadataProviderKey.GOOGLE]: 'g1' });
      expect(resolved.coverUrl).toBe('https://amazon/e.jpg');
      expect(resolved.audioCoverUrl).toBe('https://itunes/a.jpg');
      expect(diagnostics.coverSlots).toEqual({
        ebook: { provider: MetadataProviderKey.AMAZON, pass: 1 },
        audio: { provider: MetadataProviderKey.ITUNES, pass: 2 },
      });
    });

    it('holds pass-2 candidates to the book pass 1 identified', async () => {
      usePreferences((preferences) => {
        preferences.fields.audioCover.providers = [MetadataProviderKey.ITUNES];
      });
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: { title: 'Dune', authors: ['Frank Herbert'] } },
        [MetadataProviderKey.ITUNES]: {
          ebook: { title: 'Dune', authors: ['Frank Herbert'] },
          audio: { title: 'The Dune Cookbook Companion', authors: ['Someone Else'], ...square('https://itunes/wrong.jpg') },
        },
      });

      const { resolved, diagnostics } = await pipeline.runWithSources({ title: 'Dune', author: 'Frank Herbert', isAudiobook: false }, {}, undefined, {
        coverMedia: BOTH,
      });

      expect(searches()).toHaveLength(2);
      expect(resolved.audioCoverUrl).toBeUndefined();
      expect(diagnostics.coverSlots?.audio).toEqual({ provider: null, pass: null });
    });

    it('never saves the ids pass 2 found, since each id column is shared by both media', async () => {
      usePreferences((preferences) => {
        preferences.fields.title.providers = [MetadataProviderKey.ITUNES, MetadataProviderKey.HARDCOVER];
        preferences.fields.audioCover.providers = [MetadataProviderKey.ITUNES, MetadataProviderKey.HARDCOVER];
      });
      register(MetadataProviderKey.ITUNES, MetadataProviderKey.HARDCOVER);
      answer({
        [MetadataProviderKey.ITUNES]: { ebook: {}, audio: square('https://itunes/a.jpg') },
        [MetadataProviderKey.HARDCOVER]: { ebook: { hardcoverEditionId: 'ebook-edition' }, audio: { hardcoverEditionId: 'audio-edition' } },
      });

      const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: false }, {}, undefined, { coverMedia: BOTH });

      expect(searches()).toHaveLength(2);
      expect(resolved.audioCoverUrl).toBe('https://itunes/a.jpg');
      expect(providerIds[MetadataProviderKey.ITUNES]).toBe('itunes-ebook');
      expect(providerIds[MetadataProviderKey.HARDCOVER]).toBe('hardcover-ebook');
      expect(resolved.hardcoverEditionId).toBe('ebook-edition');
    });

    it('takes nothing but art from a provider only a cover rule brought in, apart from an audiobook id', async () => {
      usePreferences((preferences) => {
        // Community ratings name Audible and Hardcover by default, which would make them full providers.
        preferences.fields.communityRating.providers = [MetadataProviderKey.GOOGLE];
        preferences.fields.audioCover.providers = [MetadataProviderKey.AUDIBLE, MetadataProviderKey.HARDCOVER];
      });
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE, MetadataProviderKey.HARDCOVER);
      answer({
        [MetadataProviderKey.GOOGLE]: { audio: { description: 'From Google' } },
        [MetadataProviderKey.AUDIBLE]: {
          audio: {
            ...square('https://audible/a.jpg'),
            providerId: 'B0AUDIBLE',
            description: 'From Audible',
            chapters: [{ title: 'One', startMs: 0 }],
            comicMetadata: { issueNumber: '3' },
          },
        },
        [MetadataProviderKey.HARDCOVER]: { audio: { hardcoverEditionId: 'hc-edition' } },
      });

      const { resolved, providerIds } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: true }, {}, undefined, {
        coverMedia: AUDIO_ONLY,
      });

      expect(resolved.audioCoverUrl).toBe('https://audible/a.jpg');
      expect(resolved.description).toBe('From Google');
      expect(resolved.chapters).toBeUndefined();
      expect(resolved.comicMetadata).toBeUndefined();
      expect(resolved.hardcoverEditionId).toBeUndefined();
      expect(providerIds[MetadataProviderKey.AUDIBLE]).toBe('B0AUDIBLE');
      expect(providerIds[MetadataProviderKey.HARDCOVER]).toBeUndefined();
    });

    it('lets a cover-only provider be checked against the anchor without choosing it', async () => {
      usePreferences((preferences) => {
        preferences.fields.communityRating.providers = [MetadataProviderKey.GOOGLE];
        preferences.fields.audioCover.providers = [MetadataProviderKey.AUDIBLE, MetadataProviderKey.GOOGLE];
      });
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.GOOGLE]: { audio: { title: 'Dune', authors: ['Frank Herbert'], ...portrait('https://google/a.jpg') } },
        [MetadataProviderKey.AUDIBLE]: { audio: { title: 'The Hobbit', authors: ['J. R. R. Tolkien'], ...square('https://audible/wrong.jpg') } },
      });

      // The query suits Audible's record better, but only a provider that supplies fields may say which book this is.
      const { resolved } = await pipeline.runWithSources({ title: 'The Hobbit', isAudiobook: true }, {}, undefined, {
        coverMedia: AUDIO_ONLY,
      });

      expect(resolved.audioCoverUrl).toBe('https://google/a.jpg');
    });

    it('fills an empty ebook slot under fill-missing while the audio slot is already filled', async () => {
      usePreferences((preferences) => {
        preferences.fields.cover.mergeStrategy = 'fillMissing';
        preferences.fields.audioCover.mergeStrategy = 'fillMissing';
      });
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') },
        [MetadataProviderKey.AUDIBLE]: { ebook: square('https://audible/a.jpg') },
      });

      const { resolved } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: false }, { cover: null, audioCover: true }, undefined, {
        coverMedia: BOTH,
      });

      expect(resolved.coverUrl).toBe('https://google/e.jpg');
      expect(resolved.audioCoverUrl).toBeUndefined();
      expect(searches()).toHaveLength(1);
    });

    it('runs the Audiobook cover rule for a book whose only file is a read-along EPUB', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') },
        [MetadataProviderKey.ITUNES]: { ebook: portrait('https://itunes/e.jpg'), audio: square('https://itunes/a.jpg') },
        [MetadataProviderKey.AUDIBLE]: { ebook: square('https://audible/a.jpg') },
      });

      const { resolved } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: false }, {}, undefined, { coverMedia: BOTH });

      const [pass1, pass2] = searches();
      expect(pass1!.params).toMatchObject({ isAudiobook: false, includeAudiobookProviders: true });
      expect(pass1!.providers).toContain(MetadataProviderKey.AUDIBLE);
      expect(pass2!.params.isAudiobook).toBe(true);
      expect(pass2!.providers).toEqual([MetadataProviderKey.ITUNES]);
      expect(resolved.coverUrl).toBe('https://itunes/e.jpg');
      expect(resolved.audioCoverUrl).toBe('https://audible/a.jpg');
      expect(resolved.audioCoverChoices?.map((choice) => [choice.provider, choice.fit])).toEqual([
        [MetadataProviderKey.AUDIBLE, 'match'],
        [MetadataProviderKey.ITUNES, 'match'],
        [MetadataProviderKey.GOOGLE, 'mismatch'],
      ]);
    });

    it('orders a slot by shape and offers wrong-shape art only to an empty slot', async () => {
      usePreferences((preferences) => {
        preferences.fields.audioCover.providers = [MetadataProviderKey.AMAZON, MetadataProviderKey.GOODREADS, MetadataProviderKey.KOBO];
      });
      register(MetadataProviderKey.AMAZON, MetadataProviderKey.GOODREADS, MetadataProviderKey.KOBO);
      answer({
        [MetadataProviderKey.AMAZON]: { audio: portrait('https://amazon/a.jpg') },
        [MetadataProviderKey.GOODREADS]: { audio: { coverUrl: 'https://goodreads/a.jpg' } },
        [MetadataProviderKey.KOBO]: { audio: square('https://kobo/a.jpg') },
      });
      const params = { title: 'Dune', isAudiobook: true };

      const empty = await pipeline.runWithSources(params, { audioCover: null }, undefined, { coverMedia: AUDIO_ONLY });
      const filled = await pipeline.runWithSources(params, { audioCover: true }, undefined, { coverMedia: AUDIO_ONLY });

      expect(empty.resolved.audioCoverChoices?.map((choice) => [choice.provider, choice.fit])).toEqual([
        [MetadataProviderKey.KOBO, 'match'],
        [MetadataProviderKey.GOODREADS, 'unknown'],
        [MetadataProviderKey.AMAZON, 'mismatch'],
      ]);
      expect(filled.resolved.audioCoverChoices?.map((choice) => choice.provider)).toEqual([MetadataProviderKey.KOBO, MetadataProviderKey.GOODREADS]);
    });

    it('skips a cover the provider says is a thumbnail', async () => {
      usePreferences((preferences) => {
        preferences.fields.audioCover.providers = [MetadataProviderKey.HARDCOVER, MetadataProviderKey.KOBO];
      });
      register(MetadataProviderKey.HARDCOVER, MetadataProviderKey.KOBO);
      answer({
        [MetadataProviderKey.HARDCOVER]: { audio: { ...square('https://hardcover/thumb.jpg'), coverWidth: 98, coverHeight: 98 } },
        [MetadataProviderKey.KOBO]: { audio: square('https://kobo/a.jpg') },
      });

      const { resolved } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: true }, {}, undefined, { coverMedia: AUDIO_ONLY });

      expect(resolved.audioCoverChoices?.map((choice) => choice.url)).toEqual(['https://kobo/a.jpg']);
    });

    it('neither resolves nor searches for a locked slot', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') },
        [MetadataProviderKey.AUDIBLE]: { ebook: square('https://audible/a.jpg') },
      });

      const { resolved, diagnostics } = await pipeline.runWithSources({ title: 'Dune', isAudiobook: false }, {}, undefined, {
        coverMedia: BOTH,
        lockedCoverSlots: ['audio'],
      });

      expect(searches()).toHaveLength(1);
      expect(resolved.coverUrl).toBe('https://google/e.jpg');
      expect(resolved.audioCoverUrl).toBeUndefined();
      expect(diagnostics.coverSlots).toEqual({ ebook: { provider: MetadataProviderKey.GOOGLE, pass: 1 } });
    });

    it('asks nobody again in existing-only mode and fills the other slot from pass 1', async () => {
      usePreferences((preferences) => {
        preferences.options = { ...preferences.options!, providerIdMode: 'existingOnly' };
      });
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE);
      answer({
        [MetadataProviderKey.GOOGLE]: { ebook: portrait('https://google/e.jpg') },
        [MetadataProviderKey.ITUNES]: { ebook: portrait('https://itunes/e.jpg') },
        [MetadataProviderKey.AUDIBLE]: { ebook: square('https://audible/a.jpg') },
      });

      const { resolved } = await pipeline.runWithSources(
        {
          title: 'Dune',
          isAudiobook: false,
          existingProviderIds: {
            [MetadataProviderKey.GOOGLE]: 'g1',
            [MetadataProviderKey.ITUNES]: 'i1',
            [MetadataProviderKey.AUDIBLE]: 'B0',
          },
        },
        {},
        undefined,
        { coverMedia: BOTH },
      );

      expect(searches()).toHaveLength(1);
      expect(resolved.audioCoverUrl).toBe('https://audible/a.jpg');
      expect(resolved.audioCoverChoices?.map((choice) => choice.provider)).not.toContain(MetadataProviderKey.ITUNES);
    });

    it('narrows the effective provider keys to a book without audio', async () => {
      usePreferences();
      register(MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE, MetadataProviderKey.LIBROFM);

      await expect(pipeline.getEffectiveProviderKeys(undefined, EBOOK_ONLY)).resolves.toEqual([MetadataProviderKey.GOOGLE]);
      await expect(pipeline.getEffectiveProviderKeys(undefined, AUDIO_ONLY)).resolves.toEqual(
        expect.arrayContaining([MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE, MetadataProviderKey.LIBROFM]),
      );
    });
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
