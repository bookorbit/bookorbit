import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';
import type { Mocked } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { IdentifiableProvider, MetadataProvider } from './providers/metadata-provider';

type DbMock = {
  query: {
    bookMetadata: {
      findFirst: vi.Mock;
    };
  };
};

function candidate(provider: MetadataProviderKey, providerId: string, title = `${provider}-${providerId}`): MetadataCandidate {
  return { provider, providerId, title };
}

describe('MetadataFetchService', () => {
  let registry: Mocked<ProviderRegistry>;
  let db: DbMock;
  let service: MetadataFetchService;

  beforeEach(() => {
    registry = {
      all: vi.fn(),
      select: vi.fn(),
      find: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    db = {
      query: {
        bookMetadata: {
          findFirst: vi.fn(),
        },
      },
    };

    const throttleTracker = { clearOnSuccess: vi.fn(), record: vi.fn() } as unknown as ProviderThrottleTracker;
    service = new MetadataFetchService(registry, throttleTracker, db as never);
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
    expect(google.search).toHaveBeenCalledWith({ title: 'Dune' });
    expect(openLibrary.search).toHaveBeenCalledWith({ title: 'Dune' });
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
    expect(google.search).toHaveBeenNthCalledWith(1, {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441013593',
    });
    expect(google.search).toHaveBeenNthCalledWith(2, {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: undefined,
    });
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
    expect(google.search).toHaveBeenCalledWith({ title: 'Dune', isbn: '9780441013593' });
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
    expect(google.search).toHaveBeenCalledWith({ isbn: '9780441013593' });
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
    expect(google.lookupById).toHaveBeenCalledWith('stored-id');
    expect(google.search).not.toHaveBeenCalled();
  });

  it('returns no result when lookupById returns null for an existing provider id', async () => {
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

    expect(results).toEqual([]);
    expect(google.lookupById).toHaveBeenCalledWith('missing');
    expect(google.search).not.toHaveBeenCalled();
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

  it('returns mapped stored provider ids with nulls normalized to undefined', async () => {
    db.query.bookMetadata.findFirst.mockResolvedValue({
      googleBooksId: 'g-1',
      goodreadsId: null,
      amazonId: 'a-1',
      hardcoverId: null,
      openLibraryId: 'ol-1',
      itunesId: null,
      audibleId: 'B0ABC12345',
    });

    const result = await service.getStoredProviderIds(42);

    expect(result).toEqual({
      [MetadataProviderKey.GOOGLE]: 'g-1',
      [MetadataProviderKey.GOODREADS]: undefined,
      [MetadataProviderKey.AMAZON]: 'a-1',
      [MetadataProviderKey.HARDCOVER]: undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: 'ol-1',
      [MetadataProviderKey.ITUNES]: undefined,
      [MetadataProviderKey.AUDIBLE]: 'B0ABC12345',
    });
    expect(db.query.bookMetadata.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns an empty object when no metadata row exists for a book', async () => {
    db.query.bookMetadata.findFirst.mockResolvedValue(undefined);

    await expect(service.getStoredProviderIds(999)).resolves.toEqual({});
  });
});
