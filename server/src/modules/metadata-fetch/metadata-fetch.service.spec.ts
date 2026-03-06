import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { IdentifiableProvider, MetadataProvider } from './providers/metadata-provider';

type DbMock = {
  query: {
    bookMetadata: {
      findFirst: jest.Mock;
    };
  };
};

function candidate(provider: MetadataProviderKey, providerId: string, title = `${provider}-${providerId}`): MetadataCandidate {
  return { provider, providerId, title };
}

describe('MetadataFetchService', () => {
  let registry: jest.Mocked<ProviderRegistry>;
  let db: DbMock;
  let service: MetadataFetchService;

  beforeEach(() => {
    registry = {
      all: jest.fn(),
      select: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<ProviderRegistry>;

    db = {
      query: {
        bookMetadata: {
          findFirst: jest.fn(),
        },
      },
    };

    service = new MetadataFetchService(registry, db as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('merges candidate streams from multiple providers', async () => {
    const google: MetadataProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: false,
      search: jest.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'g1')]),
    };
    const openLibrary: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: jest.fn().mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1'), candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol2')]),
    };
    registry.select.mockReturnValue([google, openLibrary]);

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(results).toHaveLength(3);
    expect(results).toEqual(
      expect.arrayContaining([
        candidate(MetadataProviderKey.GOOGLE, 'g1'),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1'),
        candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol2'),
      ]),
    );
    expect(google.search).toHaveBeenCalledWith({ title: 'Dune' });
    expect(openLibrary.search).toHaveBeenCalledWith({ title: 'Dune' });
  });

  it('uses lookupById for identifiable providers when existing provider ids are present', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: jest.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'search-id')]),
      lookupById: jest.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'stored-id')),
    };
    registry.select.mockReturnValue([google]);

    const results = await firstValueFrom(
      service.search({ title: 'Dune', existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'stored-id' } }).pipe(toArray()),
    );

    expect(results).toEqual([candidate(MetadataProviderKey.GOOGLE, 'stored-id')]);
    expect(google.lookupById).toHaveBeenCalledWith('stored-id');
    expect(google.search).not.toHaveBeenCalled();
  });

  it('returns no result when lookupById returns null for an existing provider id', async () => {
    const google: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: jest.fn().mockResolvedValue([candidate(MetadataProviderKey.GOOGLE, 'search-id')]),
      lookupById: jest.fn().mockResolvedValue(null),
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
      search: jest.fn().mockRejectedValue(new Error('bad upstream response')),
    };
    const healthy: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: jest.fn().mockResolvedValue([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1')]),
    };
    registry.select.mockReturnValue([failing, healthy]);

    const results = await firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));

    expect(results).toEqual([candidate(MetadataProviderKey.OPEN_LIBRARY, 'ol1')]);
  });

  it('times out a stalled provider instead of hanging indefinitely', async () => {
    jest.useFakeTimers();

    const stalled: MetadataProvider = {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'OpenLibrary',
      identifiable: false,
      search: jest.fn().mockImplementation(() => new Promise<MetadataCandidate[]>(() => undefined)),
    };
    registry.select.mockReturnValue([stalled]);

    const searchPromise = firstValueFrom(service.search({ title: 'Dune' }).pipe(toArray()));
    let settled = false;
    void searchPromise.then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(searchPromise).resolves.toEqual([]);
  });

  it('looks up by provider id only for identifiable providers', async () => {
    const nonIdentifiable: MetadataProvider = {
      key: MetadataProviderKey.AMAZON,
      label: 'Amazon',
      identifiable: false,
      search: jest.fn(),
    };
    const identifiable: IdentifiableProvider = {
      key: MetadataProviderKey.GOOGLE,
      label: 'Google',
      identifiable: true,
      search: jest.fn(),
      lookupById: jest.fn().mockResolvedValue(candidate(MetadataProviderKey.GOOGLE, 'vol-1')),
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
    });

    const result = await service.getStoredProviderIds(42);

    expect(result).toEqual({
      [MetadataProviderKey.GOOGLE]: 'g-1',
      [MetadataProviderKey.GOODREADS]: undefined,
      [MetadataProviderKey.AMAZON]: 'a-1',
      [MetadataProviderKey.HARDCOVER]: undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: 'ol-1',
    });
    expect(db.query.bookMetadata.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns an empty object when no metadata row exists for a book', async () => {
    db.query.bookMetadata.findFirst.mockResolvedValue(undefined);

    await expect(service.getStoredProviderIds(999)).resolves.toEqual({});
  });
});
