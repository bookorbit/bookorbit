import { MetadataProviderKey, ProviderThrottleRuntimeSnapshot } from '@projectx/types';
import type { Mocked } from 'vitest';
import { firstValueFrom, of, toArray } from 'rxjs';

import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { ProviderThrottleTracker } from './provider-throttle.tracker';

describe('MetadataFetchController', () => {
  let service: Mocked<MetadataFetchService>;
  let registry: Mocked<ProviderRegistry>;
  let providerConfig: Mocked<ProviderConfigService>;
  let throttleTracker: Mocked<ProviderThrottleTracker>;
  let controller: MetadataFetchController;

  beforeEach(() => {
    service = {
      search: vi.fn(),
      getStoredProviderIds: vi.fn(),
      lookupById: vi.fn(),
    } as unknown as Mocked<MetadataFetchService>;

    registry = {
      all: vi.fn(),
    } as unknown as Mocked<ProviderRegistry>;

    providerConfig = {
      getConfig: vi.fn().mockResolvedValue({}),
      getProviderStatuses: vi.fn(),
    } as unknown as Mocked<ProviderConfigService>;

    throttleTracker = {
      snapshot: vi.fn(),
    } as unknown as Mocked<ProviderThrottleTracker>;

    controller = new MetadataFetchController(service, registry, providerConfig, throttleTracker);
  });

  it('returns provider metadata for UI configuration', async () => {
    registry.all.mockReturnValue([
      { key: MetadataProviderKey.GOOGLE, label: 'Google Books', identifiable: true },
      { key: MetadataProviderKey.OPEN_LIBRARY, label: 'OpenLibrary', identifiable: false },
    ] as never);

    await expect(controller.listProviders()).resolves.toEqual([
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
