import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import type { Mocked } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';

import type { RequestUser } from '../../common/types/request-user';
import { MetadataFetchRepository } from './metadata-fetch.repository';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { IdentifiableProvider, MetadataProvider } from './providers/metadata-provider';
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

describe('MetadataFetchService', () => {
  let registry: Mocked<ProviderRegistry>;
  let throttleTracker: Mocked<ProviderThrottleTracker>;
  let metadataFetchRepository: Mocked<MetadataFetchRepository>;
  let service: MetadataFetchService;

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

    service = new MetadataFetchService(registry, throttleTracker, metadataFetchRepository);
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

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

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

    const search = firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

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

    const results = await firstValueFrom(service.search({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593' }).pipe(toArray()));

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

    const results = await firstValueFrom(service.search({ title: 'Dune', isbn: '9780441013593' }).pipe(toArray()));

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

    const results = await firstValueFrom(service.search({ isbn: '9780441013593' }).pipe(toArray()));

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
      service.search({ title: 'Confessor', author: 'Terry Goodkin', isbn: '9781662539374', isAudiobook: true }).pipe(toArray()),
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
        .pipe(toArray()),
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
      service.search({ title: 'Dune', existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' } }).pipe(toArray()),
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
      service.search({ title: 'Dune', existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'missing' } }).pipe(toArray()),
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
        .pipe(toArray()),
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
        .pipe(toArray()),
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

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

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

    const searchPromise = firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));
    let settled = false;
    void searchPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(searchPromise).resolves.toEqual([]);
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
    await expect(service.lookupById(MetadataProviderKey.GOOGLE, 'vol-1')).resolves.toEqual(candidate(MetadataProviderKey.GOOGLE, 'vol-1'));
    await expect(service.lookupById(MetadataProviderKey.OPEN_LIBRARY, 'ol1')).resolves.toBeNull();

    expect(identifiable.lookupById).toHaveBeenCalledWith('vol-1');
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
      koboId: null,
      comicvineId: null,
      ranobedbId: null,
      lubimyczytacId: null,
      aladinId: null,
    });
    metadataFetchRepository.hasLibraryAccess.mockResolvedValue(false);

    await expect(service.getStoredProviderIds(5, makeUser({ id: 12 }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
