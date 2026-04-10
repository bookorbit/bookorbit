import { firstValueFrom, toArray } from 'rxjs';

import { AuthorMetadataProviderError } from './providers/author-metadata-provider';
import { AuthorMetadataFetchService } from './author-metadata-fetch.service';

describe('AuthorMetadataFetchService', () => {
  const registry = {
    all: vi.fn(),
    select: vi.fn(),
    find: vi.fn(),
  };

  let service: AuthorMetadataFetchService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthorMetadataFetchService(registry as never);
  });

  it('listProviders maps registry providers for client display', () => {
    registry.all.mockReturnValue([
      { key: 'audnexus', label: 'Audnexus', identifiable: true },
      { key: 'other', label: 'Other', identifiable: false },
    ]);

    expect(service.listProviders()).toEqual([
      { key: 'audnexus', label: 'Audnexus', identifiable: true },
      { key: 'other', label: 'Other', identifiable: false },
    ]);
  });

  it('quickSearchDetailed returns candidate when provider succeeds', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          {
            provider: 'audnexus',
            providerId: 'A1',
            name: 'Author One',
          },
        ]),
      },
    ]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toEqual({
      candidate: {
        provider: 'audnexus',
        providerId: 'A1',
        name: 'Author One',
      },
      failure: null,
    });
  });

  it('quickSearchDetailed exposes provider failure metadata for retry handling', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockRejectedValue(
          new AuthorMetadataProviderError('429 too many requests', {
            httpStatus: 429,
            retryAfterMs: 20_000,
            transient: true,
          }),
        ),
      },
    ]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toEqual({
      candidate: null,
      failure: {
        provider: 'audnexus',
        message: '429 too many requests',
        httpStatus: 429,
        retryAfterMs: 20_000,
        transient: true,
      },
    });
  });

  it('search returns empty when no providers match the filter', async () => {
    registry.select.mockReturnValue([]);

    await expect(service.search({ name: 'Nobody' }, { keys: ['audnexus'] })).resolves.toEqual([]);
  });

  it('search clamps limit and tolerates provider failures by returning successful batches', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]),
      },
      {
        key: 'other',
        label: 'Other',
        identifiable: false,
        search: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      },
    ]);

    await expect(service.search({ name: 'Author One', limit: 0 })).resolves.toEqual([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]);
  });

  it('stream enforces global result limit across providers', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'audnexus', providerId: 'A1', name: 'Author One' },
          { provider: 'audnexus', providerId: 'A2', name: 'Author Two' },
        ]),
      },
      {
        key: 'other',
        label: 'Other',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'other', providerId: 'B1', name: 'Author Three' },
          { provider: 'other', providerId: 'B2', name: 'Author Four' },
        ]),
      },
    ]);

    const emitted = await firstValueFrom(service.stream({ name: 'author', limit: 2 }).pipe(toArray()));
    expect(emitted).toHaveLength(2);
  });

  it('quickSearchDetailed falls back to the best search candidate when identifiable lookup fails', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]),
      lookupById: vi.fn().mockRejectedValue(new Error('lookup failed')),
    };
    registry.select.mockReturnValue([provider]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toEqual({
      candidate: { provider: 'audnexus', providerId: 'A1', name: 'Author One' },
      failure: null,
    });
  });

  it('lookupById returns null when provider is missing or not identifiable', async () => {
    registry.find.mockReturnValueOnce(undefined).mockReturnValueOnce({
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: false,
      search: vi.fn(),
    });

    await expect(service.lookupById('audnexus', 'x1')).resolves.toBeNull();
    await expect(service.lookupById('audnexus', 'x2')).resolves.toBeNull();
  });

  it('lookupById delegates to identifiable provider', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn(),
      lookupById: vi.fn().mockResolvedValue({ provider: 'audnexus', providerId: '42', name: 'Douglas Adams' }),
    };
    registry.find.mockReturnValue(provider);

    await expect(service.lookupById('audnexus', '42', 'us')).resolves.toEqual({
      provider: 'audnexus',
      providerId: '42',
      name: 'Douglas Adams',
    });
    expect(provider.lookupById).toHaveBeenCalledWith('42', 'us');
  });
});
