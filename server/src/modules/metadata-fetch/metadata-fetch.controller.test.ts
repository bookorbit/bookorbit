import { MetadataProviderKey, ProviderConfigurations, ProviderThrottleRuntimeSnapshot } from '@bookorbit/types';
import type { Mocked } from 'vitest';
import { firstValueFrom, of, toArray } from 'rxjs';

import type { RequestUser } from '../../common/types/request-user';
import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

describe('MetadataFetchController', () => {
  let service: Mocked<MetadataFetchService>;
  let pipeline: Mocked<MetadataFetchPipeline>;
  let registry: Mocked<ProviderRegistry>;
  let providerConfig: Mocked<ProviderConfigService>;
  let metadataPreferences: Mocked<MetadataPreferencesService>;
  let throttleTracker: Mocked<ProviderThrottleTracker>;
  let controller: MetadataFetchController;
  let user: RequestUser;
  const providerInfos = [
    { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
    { key: MetadataProviderKey.AMAZON, label: 'Amazon', identifiable: true },
    { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    { key: MetadataProviderKey.AUDIBLE, label: 'Audible', identifiable: true },
    { key: MetadataProviderKey.AUDNEXUS, label: 'AudNexus', identifiable: false },
    { key: MetadataProviderKey.KOBO, label: 'Kobo', identifiable: true },
  ];

  beforeEach(() => {
    service = {
      search: vi.fn(),
      getStoredProviderIds: vi.fn(),
      getStoredProviderContext: vi.fn(),
      getAccessibleBookLibraryId: vi.fn(),
      lookupById: vi.fn(),
    } as unknown as Mocked<MetadataFetchService>;

    pipeline = {
      getEffectiveProviderKeys: vi.fn(),
    } as unknown as Mocked<MetadataFetchPipeline>;

    registry = {
      all: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    providerConfig = {
      getConfig: vi.fn().mockResolvedValue(makeProviderConfig()),
      getProviderStatuses: vi.fn(),
    } as unknown as Mocked<ProviderConfigService>;

    const resolver = new MetadataPreferenceResolver();
    metadataPreferences = {
      getGlobal: vi.fn().mockResolvedValue(resolver.getDefaultPreferences()),
    } as unknown as Mocked<MetadataPreferencesService>;

    throttleTracker = {
      snapshot: vi.fn(),
    } as unknown as Mocked<ProviderThrottleTracker>;
    registry.all.mockReturnValue(providerInfos as never);

    controller = new MetadataFetchController(service, pipeline, registry, providerConfig, throttleTracker, metadataPreferences);
    user = {
      id: 7,
      username: 'reader',
      name: 'Reader',
      email: null,
      active: true,
      isSuperuser: false,
      isDefaultPassword: false,
      tokenVersion: 1,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'local',
      permissions: [],
    };
  });

  it('returns provider metadata for UI configuration', async () => {
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ] as never);

    await expect(controller.listProviders({}, user)).resolves.toEqual([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ]);
  });

  it('returns provider metadata scoped to the current book library when bookId is provided', async () => {
    service.getAccessibleBookLibraryId.mockResolvedValue(9);
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.KOBO, MetadataProviderKey.GOOGLE]);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
      { key: MetadataProviderKey.KOBO, label: 'Kobo', identifiable: true },
    ] as never);

    const result = await controller.listProviders({ bookId: 12 }, user);

    expect(service.getAccessibleBookLibraryId).toHaveBeenCalledWith(12, user);
    expect(pipeline.getEffectiveProviderKeys).toHaveBeenCalledWith(9);
    expect(result).toEqual([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true, selectedByFieldRules: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false, selectedByFieldRules: false },
      { key: MetadataProviderKey.KOBO, label: 'Kobo', identifiable: true, selectedByFieldRules: true },
    ]);
  });

  it('streams metadata candidates and enriches search params with stored provider ids when bookId is present', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: { [MetadataProviderKey.GOOGLE]: 'vol-1' } });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
    service.search.mockReturnValue(
      of(
        { provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First' },
        { provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol-1', title: 'Second' },
      ),
    );

    const dto: MetadataSearchDto = {
      bookId: 12,
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
    };

    const stream = await controller.stream(dto, user);
    const events = await firstValueFrom(stream.pipe(toArray()));

    expect(service.getStoredProviderContext).toHaveBeenCalledWith(12, user);
    expect(pipeline.getEffectiveProviderKeys).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'vol-1' },
        isAudiobook: false,
      },
      [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
    );
    expect(events).toEqual([
      { data: { provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First' } },
      { data: { provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol-1', title: 'Second' } },
    ]);
  });

  it('allows explicit book searches to use enabled providers outside field rules', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: {} });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.GOOGLE]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.KOBO, providerId: 'kobo-1', title: 'Kobo Result' }));

    const stream = await controller.stream({ bookId: 12, title: 'Dune', providers: [MetadataProviderKey.KOBO] }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(pipeline.getEffectiveProviderKeys).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }), [MetadataProviderKey.KOBO]);
  });

  it('filters blocklisted genres from streamed metadata candidates', async () => {
    const resolver = new MetadataPreferenceResolver();
    const preferences = resolver.getDefaultPreferences();
    preferences.options!.genres.blocklist = ['Audiobook'];
    metadataPreferences.getGlobal.mockResolvedValue(preferences);
    service.search.mockReturnValue(
      of({ provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First', genres: ['Science Fiction', 'audiobook'] }),
    );

    const stream = await controller.stream({ title: 'Dune' }, user);
    const events = await firstValueFrom(stream.pipe(toArray()));

    expect(events).toEqual([{ data: { provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First', genres: ['Science Fiction'] } }]);
  });

  it('skips stored provider lookup when bookId is not provided', async () => {
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.GOOGLE, providerId: 'vol-2', title: 'Only' }));

    const dto: MetadataSearchDto = { title: 'Dune' };
    const stream = await controller.stream(dto, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.getStoredProviderContext).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: undefined,
        isbn: undefined,
        existingProviderIds: {},
        isAudiobook: false,
      },
      [
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.OPEN_LIBRARY,
        MetadataProviderKey.AUDIBLE,
        MetadataProviderKey.AUDNEXUS,
        MetadataProviderKey.KOBO,
      ],
    );
  });

  it('uses enabled provider config when stream providers are omitted', async () => {
    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        google: { enabled: false, apiKey: '' },
        openLibrary: { enabled: false },
        audible: { enabled: false, domain: 'com' },
        audnexus: { enabled: false },
        kobo: { enabled: true, country: 'us', language: 'en' },
        lubimyczytac: { enabled: false },
      }),
    );
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.KOBO, providerId: 'dune-1', title: 'Dune' }));

    const stream = await controller.stream({ title: 'Dune' }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }), [MetadataProviderKey.KOBO]);
  });

  it('infers audiobook search when audiobook providers are requested', async () => {
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.AUDIBLE, providerId: 'B001', title: 'Audio Result' }));

    const dto: MetadataSearchDto = {
      title: 'All Systems Red',
      providers: [MetadataProviderKey.AUDIBLE, MetadataProviderKey.AUDNEXUS],
    };
    const stream = await controller.stream(dto, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'All Systems Red',
        isAudiobook: true,
      }),
      [MetadataProviderKey.AUDIBLE, MetadataProviderKey.AUDNEXUS],
    );
  });

  it('infers audiobook search when the effective provider set is only audiobook providers', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: {} });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.AUDIBLE]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.AUDIBLE, providerId: 'B002V1NSN2', title: 'Confessor' }));

    const stream = await controller.stream({ bookId: 44, title: 'Confessor', author: 'Terry Goodkind' }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Confessor',
        author: 'Terry Goodkind',
        isAudiobook: true,
      }),
      [MetadataProviderKey.AUDIBLE],
    );
  });

  it('infers audiobook search from stored audible ids when providers are not specified', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 8, providerIds: { [MetadataProviderKey.AUDIBLE]: 'B0ABC12345' } });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.OPEN_LIBRARY,
      MetadataProviderKey.AUDIBLE,
      MetadataProviderKey.AUDNEXUS,
      MetadataProviderKey.KOBO,
    ]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.AUDNEXUS, providerId: 'B0ABC12345', title: 'Audio Result' }));

    const dto: MetadataSearchDto = {
      bookId: 44,
      title: 'Artificial Condition',
    };
    const stream = await controller.stream(dto, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0ABC12345' },
        isAudiobook: true,
      }),
      [
        MetadataProviderKey.GOOGLE,
        MetadataProviderKey.OPEN_LIBRARY,
        MetadataProviderKey.AUDIBLE,
        MetadataProviderKey.AUDNEXUS,
        MetadataProviderKey.KOBO,
      ],
    );
  });

  it('delegates lookup requests to the metadata fetch service and filters blocklisted genres', async () => {
    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }),
    );
    const resolver = new MetadataPreferenceResolver();
    const preferences = resolver.getDefaultPreferences();
    preferences.options!.genres.blocklist = ['Adult'];
    metadataPreferences.getGlobal.mockResolvedValue(preferences);
    service.lookupById.mockResolvedValue({
      provider: MetadataProviderKey.AMAZON,
      providerId: 'B123',
      title: 'Amazon Title',
      genres: ['Adult', 'Mystery'],
    });

    const dto: LookupMetadataDto = { provider: MetadataProviderKey.AMAZON, id: 'B123' };
    const result = await controller.lookup(dto);

    expect(service.lookupById).toHaveBeenCalledWith(MetadataProviderKey.AMAZON, 'B123');
    expect(result).toEqual({ provider: MetadataProviderKey.AMAZON, providerId: 'B123', title: 'Amazon Title', genres: ['Mystery'] });
  });

  it('returns null for lookup requests when the provider is disabled', async () => {
    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
      }),
    );

    const result = await controller.lookup({ provider: MetadataProviderKey.AMAZON, id: 'B123' });

    expect(result).toBeNull();
    expect(service.lookupById).not.toHaveBeenCalled();
  });

  it('returns runtime provider throttle state for admin metadata settings', async () => {
    const config = { google: { enabled: true, apiKey: '' } };
    providerConfig.getConfig.mockResolvedValue(config as never);
    providerConfig.getProviderStatuses.mockResolvedValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', enabled: true, configured: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'Open Library', enabled: true, configured: true },
      { key: MetadataProviderKey.HARDCOVER, label: 'Hardcover', enabled: true, configured: true },
    ] as never);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'Open Library', identifiable: true },
    ] as never);

    const runtime: ProviderThrottleRuntimeSnapshot = {
      observedAt: '2026-04-08T12:00:00.000Z',
      providers: [
        {
          key: MetadataProviderKey.GOOGLE,
          throttled: true,
          throttledUntil: '2026-04-08T12:05:00.000Z',
          remainingSeconds: 300,
          backoffLevel: 2,
        },
      ],
    };
    throttleTracker.snapshot.mockReturnValue(runtime);

    const result = await controller.listProviderRuntime();

    expect(providerConfig.getConfig).toHaveBeenCalledTimes(1);
    expect(providerConfig.getProviderStatuses).toHaveBeenCalledWith(config);
    expect(registry.all).toHaveBeenCalledTimes(1);
    expect(throttleTracker.snapshot).toHaveBeenCalledWith([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
    expect(result).toEqual(runtime);
  });
});

function makeProviderConfig(overrides: Partial<ProviderConfigurations> = {}): ProviderConfigurations {
  return {
    google: { enabled: true, apiKey: '', ...overrides.google },
    amazon: { enabled: false, domain: 'amazon.com', cookie: '', ...overrides.amazon },
    goodreads: { enabled: false, ...overrides.goodreads },
    hardcover: { enabled: false, apiKey: '', ...overrides.hardcover },
    openLibrary: { enabled: true, ...overrides.openLibrary },
    itunes: { enabled: false, coverResolution: 'high', ...overrides.itunes },
    audible: { enabled: true, domain: 'com', ...overrides.audible },
    audnexus: { enabled: true, ...overrides.audnexus },
    comicvine: { enabled: false, apiKey: '', ...overrides.comicvine },
    ranobedb: { enabled: false, ...overrides.ranobedb },
    kobo: { enabled: true, country: 'us', language: 'en', ...overrides.kobo },
    lubimyczytac: { enabled: false, ...overrides.lubimyczytac },
    aladin: { enabled: false, ttbKey: '', ...overrides.aladin },
  };
}
