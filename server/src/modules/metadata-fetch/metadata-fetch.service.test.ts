import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import type { Mocked } from 'vitest';
import { filter, firstValueFrom, map, pipe, toArray } from 'rxjs';

import type { RequestUser } from '../../common/types/request-user';
import { createTestExecutor, type TestExecutorHarness } from '../metadata-cache/test-helpers';
import { recordProviderRequest } from '../../common/provider-cache/provider-call-context';
import type { CacheDirective, ProviderCacheSpec } from '../../common/provider-cache/provider-cache-spec';
import { MetadataFetchRepository } from './metadata-fetch.repository';
import { MetadataFetchService, MetadataSearchEvent } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleError } from './provider-throttle.error';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { IdentifiableProvider, MetadataProvider } from './providers/metadata-provider';
import type { MetadataSearchParams } from './providers/metadata-search-params';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function candidate(provider: MetadataProviderKey, providerId: string, title = `${provider}-${providerId}`): MetadataCandidate {
  return { provider, providerId, title };
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'user',
    name: 'Test User',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type CandidateEvent = Extract<MetadataSearchEvent, { kind: 'candidate' }>;

function isCandidateEvent(event: MetadataSearchEvent): event is CandidateEvent {
  return event.kind === 'candidate';
}

function candidatesOnly() {
  return pipe(
    filter(isCandidateEvent),
    map((event: CandidateEvent) => event.candidate),
  );
}

function statusesOf(events: MetadataSearchEvent[]) {
  return events.filter((event) => event.kind === 'status').map((event) => event.status);
}

describe('MetadataFetchService', () => {
  let registry: Mocked<ProviderRegistry>;
  let throttleTracker: Mocked<ProviderThrottleTracker>;
  let metadataFetchRepository: Mocked<MetadataFetchRepository>;
  let service: MetadataFetchService;
  let cacheHarness: TestExecutorHarness;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    registry = {
      all: vi.fn(),
      select: vi.fn(),
      find: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    throttleTracker = {
      clearOnSuccess: vi.fn(),
      record: vi.fn(),
    } as unknown as Mocked<ProviderThrottleTracker>;

    metadataFetchRepository = {
      findStoredProviderIdsRow: vi.fn(),
      hasLibraryAccess: vi.fn(),
    } as unknown as Mocked<MetadataFetchRepository>;

    cacheHarness = createTestExecutor();
    service = new MetadataFetchService(registry, throttleTracker, metadataFetchRepository, cacheHarness.executor);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges candidate streams from multiple providers', async () => {
    const google: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]),
    };
    const openLibrary: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi
        .fn()
        .mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune'), candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol2', 'Dune')]),
    };
    registry.select.mockReturnValue([google, openLibrary]);

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(candidatesOnly(), toArray()));

    expect(results).toHaveLength(3);
    expect(results).toEqual(
      expect.arrayContaining([
        candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune'),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune'),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol2', 'Dune'),
      ]),
    );
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }));
    expect(openLibrary.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }));
  });

  it('states every cover shape, from the provider when the candidate does not say', async () => {
    const withCover = (id: string, data: Partial<MetadataCandidate> = {}) => ({
      ...candidate(MetadataProviderKey.GOOGLE, id, 'Dune'),
      coverUrl: `https://img/${id}.jpg`,
      ...data,
    });
    const fixed: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      coverShape: 'portrait',
      search: vi
        .fn()
        .mockResolvedValue([withCover('a'), withCover('b', { coverShape: 'square' }), candidate(MetadataProviderKey.GOOGLE, 'c', 'Dune')]),
    };
    const unknown: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue([{ ...withCover('d'), provider: MetadataProviderKey.OPEN_LIBRARY }]),
    };
    registry.select.mockReturnValue([fixed, unknown]);

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(candidatesOnly(), toArray()));
    const shapes = Object.fromEntries(results.map((result) => [result.providerId, result.coverShape]));

    expect(shapes).toEqual({ a: 'portrait', b: 'square', c: undefined, d: 'unknown' });
  });

  it('starts selected providers concurrently within one search', async () => {
    let active = 0;
    let maxActive = 0;

    function makeBlockedProvider(key: MetadataProviderKey): MetadataProvider & { started: Promise<void>; release: () => void } {
      const started = deferred();
      const release = deferred();
      return {
        key,
        label: key,
        identifiable: false,
        started: started.promise,
        release: release.resolve,
        search: vi.fn().mockImplementation(async (params) => {
          active++;
          maxActive = Math.max(maxActive, active);
          started.resolve();
          try {
            await release.promise;
            return [candidate(key, `${key}-1`, params.title ?? key)];
          } finally {
            active--;
          }
        }),
      };
    }

    const google = makeBlockedProvider(MetadataProviderKey.GOOGLE);
    const openLibrary = makeBlockedProvider(MetadataProviderKey.OPEN_LIBRARY);
    registry.select.mockReturnValue([google, openLibrary]);

    const search = firstValueFrom(service.search({ title: 'Dune' }).pipe(candidatesOnly(), toArray()));

    await Promise.all([google.started, openLibrary.started]);

    expect(maxActive).toBe(2);

    google.release();
    openLibrary.release();

    await expect(search).resolves.toEqual([
      candidate(MetadataProviderKey.GOOGLE, 'google-1', 'Dune'),
      candidate(MetadataProviderKey.OPEN_LIBRARY, 'openLibrary-1', 'Dune'),
    ]);
  });

  it('falls back to non-isbn search when isbn search returns no results', async () => {
    const google: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      search: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidate(MetadataProviderKey.GOOGLE, 'g-fallback', 'Dune')]),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service.search({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593' }).pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'g-fallback', 'Dune')]);
    expect(google.search).toHaveBeenCalledTimes(2);
    expect(google.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441013593',
      }),
    );
    expect(google.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: undefined,
      }),
    );
  });

  it('does not fall back when isbn search already returns results', async () => {
    const google: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'g-isbn', 'Dune')]),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(service.search({ title: 'Dune', isbn: '9780441013593' }).pipe(candidatesOnly(), toArray()));

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'g-isbn', 'Dune')]);
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune', isbn: '9780441013593' }));
  });

  it('does not fall back when no non-isbn terms are available', async () => {
    const google: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      search: vi.fn().mockResolvedValue([]),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(service.search({ isbn: '9780441013593' }).pipe(candidatesOnly(), toArray()));

    expect(results).toEqual([]);
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ isbn: '9780441013593' }));
  });

  it('falls back to title-only search for manual searches when title-author search returns no results', async () => {
    const audible: MetadataProvider = {
      key: MetadataProviderKey.AUDIBLE,
      label: 'Audible',
      identifiable: false,
      search: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', 'Confessor')]),
    };
    registry.select.mockReturnValue([audible]);

    const results = await firstValueFrom(
      service.search({ title: 'Confessor', author: 'Terry Goodkin', isbn: '9781662539374', isAudiobook: true }).pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.AUDIBLE, 'B002V1NSN2', 'Confessor')]);
    expect(audible.search).toHaveBeenCalledTimes(3);
    expect(audible.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'Confessor', author: 'Terry Goodkin', isbn: '9781662539374' }),
    );
    expect(audible.search).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'Confessor', author: 'Terry Goodkin', isbn: undefined }));
    expect(audible.search).toHaveBeenNthCalledWith(3, expect.objectContaining({ title: 'Confessor', author: undefined, isbn: undefined }));
  });

  it('keeps five ranked candidates per provider unless the search asks for more', async () => {
    const books = Array.from({ length: 12 }, (_, index) => ({
      ...candidate(MetadataProviderKey.OPEN_LIBRARY, `ol${index}`, `Discworld ${index}`),
      authors: ['Terry Pratchett'],
    }));
    const openLibrary: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue(books),
    };
    registry.select.mockReturnValue([openLibrary]);

    const matching = await firstValueFrom(service.search({ author: 'Terry Pratchett' }).pipe(candidatesOnly(), toArray()));
    const browsing = await firstValueFrom(service.search({ author: 'Terry Pratchett', resultsPerProvider: 20 }).pipe(candidatesOnly(), toArray()));

    expect(matching).toHaveLength(5);
    expect(browsing).toHaveLength(12);
    expect(openLibrary.search).toHaveBeenLastCalledWith(expect.objectContaining({ resultsPerProvider: 20 }));
  });

  it('does not use title-only fallback for capped automated searches', async () => {
    const audible: MetadataProvider = {
      key: MetadataProviderKey.AUDIBLE,
      label: 'Audible',
      identifiable: false,
      search: vi.fn().mockResolvedValue([]),
    };
    registry.select.mockReturnValue([audible]);

    const results = await firstValueFrom(
      service
        .search({
          title: 'Confessor',
          author: 'Terry Goodkin',
          isbn: '9781662539374',
          isAudiobook: true,
          maxCandidatesPerProvider: 1,
        })
        .pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([]);
    expect(audible.search).toHaveBeenCalledTimes(2);
  });

  it('uses lookupById for identifiable providers when existing provider ids are present', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'search-id', 'Dune')]),
      lookupById: vi.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'stored-id', 'Dune')),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service.search({ title: 'Dune', existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' } }).pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'stored-id', 'Dune')]);
    expect(google.lookupById).toHaveBeenCalledWith(
      'stored-id',
      expect.anything(),
      expect.objectContaining({
        title: 'Dune',
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' },
      }),
    );
    expect(google.search).not.toHaveBeenCalled();
  });

  it('falls back to provider search when lookupById returns null for an existing provider id', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'search-id', 'Dune')]),
      lookupById: vi.fn().mockResolvedValue(null),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service.search({ title: 'Dune', existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'missing' } }).pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'search-id', 'Dune')]);
    expect(google.lookupById).toHaveBeenCalledWith(
      'missing',
      expect.anything(),
      expect.objectContaining({
        title: 'Dune',
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'missing' },
      }),
    );
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune' }));
  });

  it('passes ISBN context into stored provider lookups and falls back when lookup rejects the edition', async () => {
    const hardcover: IdentifiableProvider = {
      key: MetadataProviderKey.HARDCOVER,
      label: 'Hardcover',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.HARDCOVER, 'comet-in-moominland', 'Kometen kommer')]),
      lookupById: vi.fn().mockResolvedValue(null),
    };
    registry.select.mockReturnValue([hardcover]);

    const results = await firstValueFrom(
      service
        .search({
          title: 'Kometen kommer',
          author: 'Tove Jansson',
          isbn: '9789523331587',
          existingProviderIds: { [MetadataProviderKey.HARDCOVER]: 'comet-in-moominland' },
        })
        .pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.HARDCOVER, 'comet-in-moominland', 'Kometen kommer')]);
    expect(hardcover.lookupById).toHaveBeenCalledWith(
      'comet-in-moominland',
      expect.anything(),
      expect.objectContaining({
        title: 'Kometen kommer',
        author: 'Tove Jansson',
        isbn: '9789523331587',
      }),
    );
    expect(hardcover.search).toHaveBeenCalledTimes(1);
    expect(hardcover.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Kometen kommer',
        author: 'Tove Jansson',
        isbn: '9789523331587',
      }),
    );
  });

  it('falls back to provider search when lookupById returns an irrelevant candidate', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'search-id', 'Dune')]),
      lookupById: vi.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'stored-id', 'Completely Unrelated')),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service
        .search({
          title: 'Dune',
          author: 'Frank Herbert',
          existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' },
        })
        .pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'search-id', 'Dune')]);
    expect(google.lookupById).toHaveBeenCalledWith(
      'stored-id',
      expect.anything(),
      expect.objectContaining({
        title: 'Dune',
        author: 'Frank Herbert',
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' },
      }),
    );
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune', author: 'Frank Herbert' }));
  });

  it('does not search for a replacement when an exact lookup returns null in existing-only mode', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'replacement-id', 'Dune')]),
      lookupById: vi.fn().mockResolvedValue(null),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service
        .search({
          title: 'Dune',
          existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' },
          existingProviderIdsOnly: true,
        })
        .pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([]);
    expect(google.lookupById).toHaveBeenCalledOnce();
    expect(google.search).not.toHaveBeenCalled();
  });

  it('does not search for a replacement when an exact lookup fails relevance in existing-only mode', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'replacement-id', 'Dune')]),
      lookupById: vi.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'stored-id', 'Completely Unrelated')),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service
        .search({
          title: 'Dune',
          author: 'Frank Herbert',
          existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' },
          existingProviderIdsOnly: true,
        })
        .pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([]);
    expect(google.search).not.toHaveBeenCalled();
  });

  it('does not query a provider without a stored identity in existing-only mode', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'new-id', 'Dune')]),
      lookupById: vi.fn(),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service.search({ title: 'Dune', existingProviderIds: {}, existingProviderIdsOnly: true }).pipe(candidatesOnly(), toArray()),
    );

    expect(results).toEqual([]);
    expect(google.lookupById).not.toHaveBeenCalled();
    expect(google.search).not.toHaveBeenCalled();
  });

  it('allows AudNexus to use an existing Audible identity without discovery fallbacks', async () => {
    const audnexus: MetadataProvider = {
      key: MetadataProviderKey.AUDNEXUS,
      label: 'AudNexus',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.AUDNEXUS, 'B0EXISTING', 'Dune')]),
    };
    registry.select.mockReturnValue([audnexus]);

    const params = {
      title: 'Dune',
      existingProviderIds: { [MetadataProviderKey.AUDIBLE]: 'B0EXISTING' },
      existingProviderIdsOnly: true,
    };
    const results = await firstValueFrom(service.search(params).pipe(candidatesOnly(), toArray()));

    expect(results).toEqual([candidate(MetadataProviderKey.AUDNEXUS, 'B0EXISTING', 'Dune')]);
    expect(audnexus.search).toHaveBeenCalledOnce();
    expect(audnexus.search).toHaveBeenCalledWith(expect.objectContaining(params));
  });

  it('isolates provider failures so one provider error does not fail the full stream', async () => {
    const failing: MetadataProvider = {
      key: MetadataProviderKey.GOODREADS,
      label: 'Goodreads',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new Error('bad upstream response')),
    };
    const healthy: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune')]),
    };
    registry.select.mockReturnValue([failing, healthy]);

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(candidatesOnly(), toArray()));

    expect(results).toEqual([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune')]);
  });

  it('times out a stalled provider instead of hanging indefinitely', async () => {
    vi.useFakeTimers();

    const stalled: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockImplementation(() => new Promise<MetadataCandidate[]>(() => undefined)),
    };
    registry.select.mockReturnValue([stalled]);

    const searchPromise = firstValueFrom(service.search({ title: 'Dune' }).pipe(candidatesOnly(), toArray()));
    let settled = false;
    void searchPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(searchPromise).resolves.toEqual([]);
  });

  it('reports a stalled provider as a timeout rather than letting it read as empty', async () => {
    vi.useFakeTimers();

    const stalled: MetadataProvider = {
      key: MetadataProviderKey.COMICVINE,
      label: 'ComicVine',
      identifiable: false,
      search: vi.fn().mockImplementation(() => new Promise<MetadataCandidate[]>(() => undefined)),
    };
    registry.select.mockReturnValue([stalled]);

    const events = firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(statusesOf(await events)).toEqual([{ provider: MetadataProviderKey.COMICVINE, outcome: 'timeout' }]);
  });

  it('reports a throttled provider as throttled', async () => {
    const throttled: MetadataProvider = {
      key: MetadataProviderKey.COMICVINE,
      label: 'ComicVine',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new ProviderThrottleError(30)),
    };
    registry.select.mockReturnValue([throttled]);

    const events = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.COMICVINE, outcome: 'throttled' }]);
  });

  it('keeps the candidates a throttled provider had already assembled, and still records the cooldown', async () => {
    const scraped = candidate(MetadataProviderKey.GOODREADS, '222794853', 'Dune');
    const throttled: MetadataProvider = {
      key: MetadataProviderKey.GOODREADS,
      label: 'Goodreads',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new ProviderThrottleError(undefined, 'bot challenge', [scraped])),
    };
    registry.select.mockReturnValue([throttled]);

    const events = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(events.filter(isCandidateEvent).map((event) => event.candidate)).toEqual([scraped]);
    expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.GOODREADS, outcome: 'throttled' }]);
    expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.GOODREADS, undefined);
  });

  it('holds salvaged candidates to the same relevance bar as candidates from a provider that finished', async () => {
    const unrelated = candidate(MetadataProviderKey.GOODREADS, '247090873', 'A Wholly Different Book');
    const throttled: MetadataProvider = {
      key: MetadataProviderKey.GOODREADS,
      label: 'Goodreads',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new ProviderThrottleError(undefined, 'bot challenge', [unrelated])),
    };
    registry.select.mockReturnValue([throttled]);

    const events = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(events.filter(isCandidateEvent)).toEqual([]);
    expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.GOODREADS, outcome: 'throttled' }]);
  });

  it('reports a provider that errored, alongside the candidates the others found', async () => {
    const failing: MetadataProvider = {
      key: MetadataProviderKey.GOODREADS,
      label: 'Goodreads',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new Error('bad upstream response')),
    };
    const healthy: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune')]),
    };
    registry.select.mockReturnValue([failing, healthy]);

    const events = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.GOODREADS, outcome: 'failed' }]);
    expect(events.filter((event) => event.kind === 'candidate')).toHaveLength(1);
  });

  it('stays silent about providers that finish, including those that simply found nothing', async () => {
    const empty: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue([]),
    };
    registry.select.mockReturnValue([empty]);

    const events = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(statusesOf(events)).toEqual([]);
  });

  it('keeps provider status out of the candidate-only view the automatic pipeline consumes', async () => {
    const failing: MetadataProvider = {
      key: MetadataProviderKey.COMICVINE,
      label: 'ComicVine',
      identifiable: false,
      search: vi.fn().mockRejectedValue(new ProviderThrottleError(30)),
    };
    const healthy: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune')]),
    };
    registry.select.mockReturnValue([failing, healthy]);

    const candidates = await firstValueFrom(service.searchCandidates({ title: 'Dune' }).pipe(toArray()));

    expect(candidates).toEqual([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1', 'Dune')]);
  });

  it('looks up by provider id only for identifiable providers', async () => {
    const nonIdentifiable: MetadataProvider = {
      key: MetadataProviderKey.AMAZON,
      label: 'Amazon',
      identifiable: false,
      search: vi.fn(),
    };
    const identifiable: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: vi.fn(),
      lookupById: vi.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'vol-1')),
    };

    registry.find.mockReturnValueOnce(nonIdentifiable).mockReturnValueOnce(identifiable).mockReturnValueOnce(undefined);

    await expect(service.lookupById(MetadataProviderKey.AMAZON, 'a1')).resolves.toBeNull();
    await expect(service.lookupById(MetadataProviderKey.GOOGLE, 'vol-1')).resolves.toEqual({
      candidate: candidate(MetadataProviderKey.GOOGLE, 'vol-1'),
    });
    await expect(service.lookupById(MetadataProviderKey.OPEN_LIBRARY, 'ol1')).resolves.toBeNull();

    // Lookups now run under the provider's deadline, so the provider receives an abort signal.
    expect(identifiable.lookupById).toHaveBeenCalledWith('vol-1', expect.any(AbortSignal), undefined);
  });

  it('returns mapped stored provider ids when the user can access the book library', async () => {
    metadataFetchRepository.findStoredProviderIdsRow.mockResolvedValue({
      libraryId: 7,
      googleBooksId: 'g-1',
      goodreadsId: null,
      amazonId: 'a-1',
      hardcoverId: null,
      openLibraryId: 'ol-1',
      itunesId: null,
      audibleId: 'B0ABC12345',
      librofmId: '9781234567890',
      koboId: 'beautiful-ugly-3',
      comicvineId: 'cv-1',
      ranobedbId: null,
      lubimyczytacId: 'lc-1',
      aladinId: null,
    });
    metadataFetchRepository.hasLibraryAccess.mockResolvedValue(true);

    const result = await service.getStoredProviderIds(42, makeUser({ id: 5 }));

    expect(result).toEqual({
      [MetadataProviderKey.GOOGLE]: 'g-1',
      [MetadataProviderKey.GOODREADS]: undefined,
      [MetadataProviderKey.AMAZON]: 'a-1',
      [MetadataProviderKey.HARDCOVER]: undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: 'ol-1',
      [MetadataProviderKey.ITUNES]: undefined,
      [MetadataProviderKey.AUDIBLE]: 'B0ABC12345',
      [MetadataProviderKey.LIBROFM]: '9781234567890',
      [MetadataProviderKey.KOBO]: 'beautiful-ugly-3',
      [MetadataProviderKey.COMICVINE]: 'cv-1',
      [MetadataProviderKey.RANOBEDB]: undefined,
      [MetadataProviderKey.LUBIMYCZYTAC]: 'lc-1',
      [MetadataProviderKey.ALADIN]: undefined,
    });
    expect(metadataFetchRepository.hasLibraryAccess).toHaveBeenCalledWith(5, 7);
  });

  it('bypasses library access checks for superusers', async () => {
    metadataFetchRepository.findStoredProviderIdsRow.mockResolvedValue({
      libraryId: 9,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      audibleId: null,
      librofmId: null,
      koboId: null,
      comicvineId: null,
      ranobedbId: null,
      lubimyczytacId: null,
      aladinId: null,
    });

    await expect(service.getStoredProviderIds(99, makeUser({ isSuperuser: true }))).resolves.toEqual({
      [MetadataProviderKey.GOOGLE]: undefined,
      [MetadataProviderKey.GOODREADS]: undefined,
      [MetadataProviderKey.AMAZON]: undefined,
      [MetadataProviderKey.HARDCOVER]: undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: undefined,
      [MetadataProviderKey.ITUNES]: undefined,
      [MetadataProviderKey.AUDIBLE]: undefined,
      [MetadataProviderKey.LIBROFM]: undefined,
      [MetadataProviderKey.KOBO]: undefined,
      [MetadataProviderKey.COMICVINE]: undefined,
      [MetadataProviderKey.RANOBEDB]: undefined,
      [MetadataProviderKey.LUBIMYCZYTAC]: undefined,
      [MetadataProviderKey.ALADIN]: undefined,
    });
    expect(metadataFetchRepository.hasLibraryAccess).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the target book does not exist', async () => {
    metadataFetchRepository.findStoredProviderIdsRow.mockResolvedValue(null);

    await expect(service.getStoredProviderIds(999, makeUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when the user cannot access the target library', async () => {
    metadataFetchRepository.findStoredProviderIdsRow.mockResolvedValue({
      libraryId: 4,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      audibleId: null,
      librofmId: null,
      koboId: null,
      comicvineId: null,
      ranobedbId: null,
      lubimyczytacId: null,
      aladinId: null,
    });
    metadataFetchRepository.hasLibraryAccess.mockResolvedValue(false);

    await expect(service.getStoredProviderIds(5, makeUser({ id: 12 }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('metadata cache', () => {
    const spec: ProviderCacheSpec<MetadataSearchParams> = {
      version: 1,
      trustEmpty: false,
      context: () => Promise.resolve({ available: true, fingerprint: '{}' }),
      describeSearch: (params) => ({ inputs: { title: params.title, author: params.author, isbn: params.isbn } }),
      describeLookup: (providerId) => ({ inputs: { id: providerId } }),
    };

    /** A provider whose answers count as complete: each search records one successful request. */
    function cachedProvider(search: MetadataProvider['search']): MetadataProvider {
      return {
        key: MetadataProviderKey.GOOGLE,
        label: 'Google',
        identifiable: false,
        cache: spec,
        search: vi.fn(async (params: MetadataSearchParams) => {
          recordProviderRequest(`GET https://example.test/${params.title}`, { kind: 'status', status: 200 });
          return search(params);
        }),
      };
    }

    async function runSearch(directive?: CacheDirective) {
      return firstValueFrom(service.search({ title: 'Dune' }, undefined, directive ? { directive } : undefined).pipe(toArray()));
    }

    it('answers a repeat search from the cache without calling the provider or clearing a cooldown', async () => {
      const provider = cachedProvider(() => Promise.resolve([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]));
      registry.select.mockReturnValue([provider]);

      const first = await runSearch();
      const second = await runSearch();

      expect(provider.search).toHaveBeenCalledTimes(1);
      expect(first.filter(isCandidateEvent)[0].cache).toBeUndefined();
      const cached = second.filter(isCandidateEvent);
      expect(cached.map((event) => event.candidate.providerId)).toEqual(['g1']);
      expect(cached[0].cache).toEqual({ fetchedAt: expect.any(String), stale: false });
      expect(throttleTracker.clearOnSuccess).toHaveBeenCalledTimes(1);
      const run = second.find((event) => event.kind === 'run');
      expect(run).toMatchObject({ kind: 'run', run: { served: { source: 'cache', stale: false }, outboundRequests: 0 } });
    });

    it('records the cooldown and reports the throttle even when a cached answer is served', async () => {
      let throttle = false;
      const provider = cachedProvider(() => {
        if (throttle) return Promise.reject(new ProviderThrottleError(120));
        return Promise.resolve([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]);
      });
      registry.select.mockReturnValue([provider]);
      await runSearch();
      throttle = true;

      const events = await runSearch({ policy: 'refresh', allowFallback: true });

      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.GOOGLE, 120);
      expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.GOOGLE, outcome: 'throttled' }]);
      const served = events.filter(isCandidateEvent);
      expect(served.map((event) => event.candidate.providerId)).toEqual(['g1']);
      expect(served[0].cache).toBeDefined();
      expect(events.find((event) => event.kind === 'run')).toMatchObject({ run: { served: { source: 'fallback' } } });
    });

    it('falls back to the cache when the provider misses its deadline', async () => {
      let hang = false;
      const provider = cachedProvider(() =>
        hang ? new Promise<MetadataCandidate[]>(() => undefined) : Promise.resolve([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]),
      );
      registry.select.mockReturnValue([{ ...provider, timeoutMs: 50 }]);
      await runSearch();
      hang = true;

      const events = await runSearch({ policy: 'refresh', allowFallback: true });

      expect(statusesOf(events)).toEqual([{ provider: MetadataProviderKey.GOOGLE, outcome: 'timeout' }]);
      expect(events.filter(isCandidateEvent).map((event) => event.candidate.providerId)).toEqual(['g1']);
    });

    it('never calls a provider asked of the cache only', async () => {
      const provider = cachedProvider(() => Promise.resolve([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]));
      registry.select.mockReturnValue([provider]);

      const events = await firstValueFrom(
        service
          .search({ title: 'Dune' }, undefined, {
            directiveByProvider: { [MetadataProviderKey.GOOGLE]: { policy: 'only-if-cached', allowFallback: false } },
          })
          .pipe(toArray()),
      );

      expect(provider.search).not.toHaveBeenCalled();
      expect(events.filter(isCandidateEvent)).toEqual([]);
      expect(statusesOf(events)).toEqual([]);
      expect(throttleTracker.clearOnSuccess).not.toHaveBeenCalled();
    });

    it('does not store an answer the provider produced without a recorded request', async () => {
      const provider: MetadataProvider = {
        key: MetadataProviderKey.GOOGLE,
        label: 'Google',
        identifiable: false,
        cache: spec,
        search: vi.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'g1', 'Dune')]),
      };
      registry.select.mockReturnValue([provider]);

      await runSearch();
      await runSearch();

      expect(provider.search).toHaveBeenCalledTimes(2);
      expect(cacheHarness.repository.rows.size).toBe(0);
    });

    it('sends providers the canonical form of the query', async () => {
      const provider = cachedProvider(() => Promise.resolve([]));
      registry.select.mockReturnValue([provider]);

      await firstValueFrom(service.search({ title: '  Dune\u00a0 Messiah ', isbn: '978-0-441-17271-9' }).pipe(toArray()));

      expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune Messiah', isbn: '9780441172719' }));
    });
  });
});
