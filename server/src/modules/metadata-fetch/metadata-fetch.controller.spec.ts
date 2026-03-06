import { MetadataProviderKey } from '@projectx/types';
import { firstValueFrom, of, toArray } from 'rxjs';

import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';

describe('MetadataFetchController', () => {
  let service: jest.Mocked<MetadataFetchService>;
  let registry: jest.Mocked<ProviderRegistry>;
  let controller: MetadataFetchController;

  beforeEach(() => {
    service = {
      search: jest.fn(),
      getStoredProviderIds: jest.fn(),
      lookupById: jest.fn(),
    } as unknown as jest.Mocked<MetadataFetchService>;

    registry = {
      all: jest.fn(),
    } as unknown as jest.Mocked<ProviderRegistry>;

    controller = new MetadataFetchController(service, registry);
  });

  it('returns provider metadata for UI configuration', () => {
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ] as never);

    expect(controller.listProviders()).toEqual([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ]);
  });

  it('streams metadata candidates and enriches search params with stored provider ids when bookId is present', async () => {
    service.getStoredProviderIds.mockResolvedValue({ [MetadataProviderKey.GOOGLE]: 'vol-1' });
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

    const stream = await controller.stream(dto);
    const events = await firstValueFrom(stream.pipe(toArray()));

    expect(service.getStoredProviderIds).toHaveBeenCalledWith(12);
    expect(service.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        existingProviderIds: { [MetadataProviderKey.GOOGLE]: 'vol-1' },
      },
      [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
    );
    expect(events).toEqual([
      { data: { provider: MetadataProviderKey.GOOGLE, providerId: 'vol-1', title: 'First' } },
      { data: { provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol-1', title: 'Second' } },
    ]);
  });

  it('skips stored provider lookup when bookId is not provided', async () => {
    service.search.mockReturnValue(of({ provider: MetadataProviderKey.GOOGLE, providerId: 'vol-2', title: 'Only' }));

    const dto: MetadataSearchDto = { title: 'Dune' };
    const stream = await controller.stream(dto);
    await firstValueFrom(stream.pipe(toArray()));

    expect(service.getStoredProviderIds).not.toHaveBeenCalled();
    expect(service.search).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: undefined,
        isbn: undefined,
        existingProviderIds: {},
      },
      undefined,
    );
  });

  it('delegates lookup requests directly to the metadata fetch service', async () => {
    service.lookupById.mockResolvedValue({ provider: MetadataProviderKey.AMAZON, providerId: 'B123', title: 'Amazon Title' });

    const dto: LookupMetadataDto = { provider: MetadataProviderKey.AMAZON, id: 'B123' };
    const result = await controller.lookup(dto);

    expect(service.lookupById).toHaveBeenCalledWith(MetadataProviderKey.AMAZON, 'B123');
    expect(result).toEqual({ provider: MetadataProviderKey.AMAZON, providerId: 'B123', title: 'Amazon Title' });
  });
});
