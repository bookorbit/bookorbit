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
});
