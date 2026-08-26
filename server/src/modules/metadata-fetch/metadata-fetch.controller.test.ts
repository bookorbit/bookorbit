import {
  METADATA_PROVIDER_STATUS_EVENT,
  MetadataCandidate,
  MetadataProviderKey,
  ProviderConfigurations,
  ProviderThrottleRuntimeSnapshot,
} from '@bookorbit/types';
import type { Mocked } from 'vitest';
import { firstValueFrom, of, toArray } from 'rxjs';

import type { RequestUser } from '../../common/types/request-user';
import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataFetchService, MetadataSearchEvent } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

function candidateEvent(candidate: MetadataCandidate): MetadataSearchEvent {
  return { kind: 'candidate', candidate };
}

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
    { key: MetadataProviderKey.LIBROFM, label: 'Libro.fm', identifiable: true },
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
      keysForMediaKind: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    providerConfig = {
      getConfig: vi.fn().mockResolvedValue(makeProviderConfig()),
      getProviderStatuses: vi.fn(),
    } as unknown as Mocked<ProviderConfigService>;

    const resolver = new MetadataPreferenceResolver();
    const defaultPreferences = resolver.getDefaultPreferences();
    metadataPreferences = {
      getGlobal: vi.fn().mockResolvedValue(defaultPreferences),
      getForLibrary: vi.fn().mockResolvedValue({ libraryId: 9, overrides: null, effective: defaultPreferences }),
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
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true, coverPriority: 4 },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false, coverPriority: 5 },
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
    expect(metadataPreferences.getForLibrary).toHaveBeenCalledWith(9);
    expect(result).toEqual([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true, selectedByFieldRules: true, coverPriority: 4 },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false, selectedByFieldRules: false, coverPriority: 5 },
      { key: MetadataProviderKey.KOBO, label: 'Kobo', identifiable: true, selectedByFieldRules: true, coverPriority: 2 },
    ]);
  });

  it('exposes the configured Cover field order independently of registry order', async () => {
    const resolver = new MetadataPreferenceResolver();
    const preferences = resolver.getDefaultPreferences();
    preferences.fields.cover.providers = [MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE];
    metadataPreferences.getGlobal.mockResolvedValue(preferences);
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ] as never);

    const result = await controller.listProviders({}, user);

    expect(result).toEqual([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true, coverPriority: 1 },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false, coverPriority: 0 },
    ]);
  });

  it('streams metadata candidates and enriches search params with stored provider ids when bookId is present', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: { [MetadataProviderKey.GOOGLE]: 'vol-1' } });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
    service.search.mockReturnValue(
      of(
        candidateEvent({ provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First' }),
        candidateEvent({ provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol-1', title: 'Second' }),
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
        seriesName: undefined,
        seriesIndex: undefined,
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'vol-1' },
        titleIsExplicitQuery: true,
        isAudiobook: false,
        includeAudiobookProviders: false,
        validateCoverPlaceholders: true,
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
    service.search.mockReturnValue(of(candidateEvent({ provider: MetadataProviderKey.KOBO, providerId: 'kobo-1', title: 'Kobo Result' })));

    const stream = await controller.stream({ bookId: 12, title: 'Dune', providers: [MetadataProviderKey.KOBO] }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(pipeline.getEffectiveProviderKeys).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }), [MetadataProviderKey.KOBO]);
  });

  it('applies genre exclusions, de-duplication, and limits to streamed metadata candidates', async () => {
    const resolver = new MetadataPreferenceResolver();
    const preferences = resolver.getDefaultPreferences();
    preferences.options!.genres.blocklist = ['Audiobook'];
    preferences.options!.genres.maxCount = 2;
    metadataPreferences.getGlobal.mockResolvedValue(preferences);
    service.search.mockReturnValue(
      of(
        candidateEvent({
          provider: MetadataProviderKey.GOOGLE,
          providerId: 'vol-1',
          title: 'First',
          genres: ['Science Fiction', 'science fiction', 'audiobook', 'Space Opera', 'Fantasy'],
        }),
      ),
    );

    const stream = await controller.stream({ title: 'Dune' }, user);
    const events = await firstValueFrom(stream.pipe(toArray()));

    expect(events).toEqual([
      { data: { provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First', genres: ['Science Fiction', 'Space Opera'] } },
    ]);
  });

  it('skips stored provider lookup when bookId is not provided', async () => {
    service.search.mockReturnValue(of(candidateEvent({ provider: MetadataProviderKey.GOOGLE, providerId: 'vol-2', title: 'Only' })));

    const dto: MetadataSearchDto = { title: 'Dune' };
    const stream = await controller.stream(dto, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.getStoredProviderContext).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: undefined,
        isbn: undefined,
        seriesName: undefined,
        seriesIndex: undefined,
        existingProviderIds: {},
        titleIsExplicitQuery: true,
        isAudiobook: false,
        includeAudiobookProviders: true,
        validateCoverPlaceholders: true,
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

  it('sends a provider status as its own SSE event so a timeout is not read as an empty result', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, title: 'Dune', seriesName: null, seriesIndex: null, providerIds: {} });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.COMICVINE]);
    service.search.mockReturnValue(
      of<MetadataSearchEvent>(candidateEvent({ provider: MetadataProviderKey.COMICVINE, providerId: 'cv-1', title: 'Found' }), {
        kind: 'status',
        status: { provider: MetadataProviderKey.COMICVINE, outcome: 'timeout' },
      }),
    );

    const stream = await controller.stream({ bookId: 12, title: 'Dune' }, user);
    const events = await firstValueFrom(stream.pipe(toArray()));

    expect(events).toEqual([
      { data: { provider: MetadataProviderKey.COMICVINE, providerId: 'cv-1', title: 'Found' } },
      { type: METADATA_PROVIDER_STATUS_EVENT, data: { provider: MetadataProviderKey.COMICVINE, outcome: 'timeout' } },
    ]);
  });

  it('does not treat the prefilled book title as a query the user typed', async () => {
    service.getStoredProviderContext.mockResolvedValue({
      libraryId: 5,
      title: 'The Amazing Spider-Man (2022) Volume 06 Issue 067',
      seriesName: 'Amazing Spider-Man',
      seriesIndex: 67,
      providerIds: {},
    });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.COMICVINE]);
    service.search.mockReturnValue(of());

    await firstValueFrom((await controller.stream({ bookId: 12, title: 'The Amazing Spider-Man (2022) Volume 06 Issue 067' }, user)).pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ titleIsExplicitQuery: false }), expect.anything());
  });

  it('marks an edited search title as a query the user typed', async () => {
    service.getStoredProviderContext.mockResolvedValue({
      libraryId: 5,
      title: 'The Amazing Spider-Man (2022) Volume 06 Issue 067',
      seriesName: 'Amazing Spider-Man',
      seriesIndex: 67,
      providerIds: {},
    });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.COMICVINE]);
    service.search.mockReturnValue(of());

    await firstValueFrom((await controller.stream({ bookId: 12, title: 'Daredevil' }, user)).pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ titleIsExplicitQuery: true }), expect.anything());
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

  it.each([MetadataProviderKey.AUDIBLE, MetadataProviderKey.AUDNEXUS, MetadataProviderKey.LIBROFM])(
    'preserves an explicit ebook media type when %s is requested alongside iTunes',
    async (audiobookProvider) => {
      registry.all.mockReturnValue([
        { key: MetadataProviderKey.ITUNES, label: 'iTunes', identifiable: true },
        { key: audiobookProvider, label: audiobookProvider, identifiable: true },
      ] as never);
      providerConfig.getConfig.mockResolvedValue(
        makeProviderConfig({
          itunes: { enabled: true, coverResolution: 'high' },
          librofm: { enabled: true },
        }),
      );
      service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: {} });
      service.search.mockReturnValue(of());
      const providers = [MetadataProviderKey.ITUNES, audiobookProvider];

      const stream = await controller.stream(
        {
          bookId: 12,
          title: 'A Game of Thrones',
          author: 'George R.R. Martin',
          isAudiobook: false,
          providers,
        },
        user,
      );
      await firstValueFrom(stream.pipe(toArray()));

      expect(service.search).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'A Game of Thrones',
          author: 'George R.R. Martin',
          isAudiobook: false,
          includeAudiobookProviders: true,
        }),
        providers,
      );
    },
  );

  it('preserves an explicit ebook media type when field rules resolve to only audiobook providers', async () => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 5, providerIds: {} });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.AUDIBLE]);
    service.search.mockReturnValue(of());

    const stream = await controller.stream({ bookId: 44, title: 'Dune', isAudiobook: false }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Dune',
        isAudiobook: false,
        includeAudiobookProviders: true,
      }),
      [MetadataProviderKey.AUDIBLE],
    );
  });

  it.each([
    [MetadataProviderKey.AUDIBLE, 'B0ABC12345'],
    [MetadataProviderKey.LIBROFM, '9781234567890'],
  ] as const)('preserves an explicit ebook media type when a stored %s id exists', async (provider, providerId) => {
    service.getStoredProviderContext.mockResolvedValue({ libraryId: 8, providerIds: { [provider]: providerId } });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.ITUNES, provider]);
    service.search.mockReturnValue(of());

    const stream = await controller.stream({ bookId: 44, title: 'Dune', isAudiobook: false }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        existingProviderIds: { [provider]: providerId },
        isAudiobook: false,
        includeAudiobookProviders: true,
      }),
      [MetadataProviderKey.ITUNES, provider],
    );
  });

  it('preserves an explicit audiobook media type when only iTunes is requested', async () => {
    registry.all.mockReturnValue([{ key: MetadataProviderKey.ITUNES, label: 'iTunes', identifiable: true }] as never);
    providerConfig.getConfig.mockResolvedValue(makeProviderConfig({ itunes: { enabled: true, coverResolution: 'high' } }));
    service.search.mockReturnValue(of());

    const stream = await controller.stream(
      {
        title: 'A Game of Thrones',
        isAudiobook: true,
        providers: [MetadataProviderKey.ITUNES],
      },
      user,
    );
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ isAudiobook: true }), [MetadataProviderKey.ITUNES]);
  });

  it('retains audiobook inference for mixed provider searches when the media type is omitted', async () => {
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.ITUNES, label: 'iTunes', identifiable: true },
      { key: MetadataProviderKey.AUDIBLE, label: 'Audible', identifiable: true },
    ] as never);
    providerConfig.getConfig.mockResolvedValue(makeProviderConfig({ itunes: { enabled: true, coverResolution: 'high' } }));
    service.search.mockReturnValue(of());

    const stream = await controller.stream(
      {
        title: 'A Game of Thrones',
        providers: [MetadataProviderKey.ITUNES, MetadataProviderKey.AUDIBLE],
      },
      user,
    );
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ isAudiobook: true }), [
      MetadataProviderKey.ITUNES,
      MetadataProviderKey.AUDIBLE,
    ]);
  });

  it('narrows the provider set to the ones serving the requested medium', async () => {
    registry.keysForMediaKind.mockReturnValue([MetadataProviderKey.COMICVINE]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.COMICVINE, providerId: '4000-1', title: 'Saga #1' }));

    const stream = await controller.stream({ title: 'Saga', mediaKind: 'comic' }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(registry.keysForMediaKind).toHaveBeenCalledWith(expect.arrayContaining([MetadataProviderKey.GOOGLE]), 'comic');
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saga', isAudiobook: false }), [MetadataProviderKey.COMICVINE]);
  });

  it('reads the medium as the audiobook signal, so an audiobook provider in the list cannot flip an ebook search', async () => {
    registry.keysForMediaKind.mockReturnValue([MetadataProviderKey.GOOGLE]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.GOOGLE, providerId: 'g1', title: 'Dune' }));

    const stream = await controller.stream(
      { title: 'Dune', mediaKind: 'ebook', providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE] },
      user,
    );
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune', isAudiobook: false, includeAudiobookProviders: false }), [
      MetadataProviderKey.GOOGLE,
    ]);
  });

  it('keeps an explicit isAudiobook flag ahead of the medium it was sent with', async () => {
    registry.keysForMediaKind.mockReturnValue([MetadataProviderKey.GOOGLE]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.GOOGLE, providerId: 'g2', title: 'Dune' }));

    const stream = await controller.stream({ title: 'Dune', mediaKind: 'ebook', isAudiobook: true }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ isAudiobook: true }), [MetadataProviderKey.GOOGLE]);
  });

  it('leaves the provider set untouched when no medium is stated', async () => {
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.GOOGLE, providerId: 'g3', title: 'Dune' }));

    const stream = await controller.stream({ title: 'Dune', providers: [MetadataProviderKey.GOOGLE] }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(registry.keysForMediaKind).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(expect.anything(), [MetadataProviderKey.GOOGLE]);
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

  it('infers audiobook search when Libro.fm is requested', async () => {
    providerConfig.getConfig.mockResolvedValue(makeProviderConfig({ librofm: { enabled: true } }));
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.LIBROFM, providerId: '9781427201438', title: 'Dune' }));

    const stream = await controller.stream({ title: 'Dune', providers: [MetadataProviderKey.LIBROFM] }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune', isAudiobook: true }), [MetadataProviderKey.LIBROFM]);
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

  it('infers audiobook search from stored Libro.fm ids when providers are not specified', async () => {
    service.getStoredProviderContext.mockResolvedValue({
      libraryId: 8,
      providerIds: { [MetadataProviderKey.LIBROFM]: '9781234567890' },
    });
    pipeline.getEffectiveProviderKeys.mockResolvedValue([MetadataProviderKey.GOOGLE, MetadataProviderKey.LIBROFM]);
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.LIBROFM, providerId: '9781234567890', title: 'Audio Result' }));

    const stream = await controller.stream({ bookId: 44, title: 'Audio Result' }, user);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        existingProviderIds: { [MetadataProviderKey.LIBROFM]: '9781234567890' },
        isAudiobook: true,
      }),
      [MetadataProviderKey.GOOGLE, MetadataProviderKey.LIBROFM],
    );
  });

  it('delegates lookup requests and applies genre fetch options', async () => {
    providerConfig.getConfig.mockResolvedValue(
      makeProviderConfig({
        amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      }),
    );
    const resolver = new MetadataPreferenceResolver();
    const preferences = resolver.getDefaultPreferences();
    preferences.options!.genres.blocklist = ['Adult'];
    preferences.options!.genres.maxCount = 1;
    metadataPreferences.getGlobal.mockResolvedValue(preferences);
    service.lookupById.mockResolvedValue({
      provider: MetadataProviderKey.AMAZON,
      providerId: 'B123',
      title: 'Amazon Title',
      genres: ['Adult', 'Mystery', 'Thriller'],
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
    librofm: { enabled: false, ...overrides.librofm },
    comicvine: { enabled: false, apiKey: '', ...overrides.comicvine },
    ranobedb: { enabled: false, ...overrides.ranobedb },
    kobo: { enabled: true, country: 'us', language: 'en', ...overrides.kobo },
    lubimyczytac: { enabled: false, ...overrides.lubimyczytac },
    aladin: { enabled: false, ttbKey: '', ...overrides.aladin },
  };
}
