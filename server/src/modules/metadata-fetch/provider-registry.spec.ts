import { BadRequestException } from '@nestjs/common';
import { MetadataProviderKey } from '@projectx/types';

import { ProviderRegistry } from './provider-registry';
import { MetadataProvider } from './providers/metadata-provider';

function createProvider(key: MetadataProviderKey, label = key): MetadataProvider {
  return {
    key,
    label,
    identifiable: false,
    search: jest.fn().mockResolvedValue([]),
  };
}

describe('ProviderRegistry', () => {
  it('returns all providers when no keys are provided', () => {
    const providers = [createProvider(MetadataProviderKey.GOOGLE), createProvider(MetadataProviderKey.GOODREADS)];
    const registry = new ProviderRegistry(providers);

    expect(registry.select()).toBe(providers);
    expect(registry.all()).toBe(providers);
  });

  it('returns an empty list when keys is explicitly empty', () => {
    const registry = new ProviderRegistry([createProvider(MetadataProviderKey.GOOGLE)]);

    expect(registry.select([])).toEqual([]);
  });

  it('selects only requested providers in registry order', () => {
    const google = createProvider(MetadataProviderKey.GOOGLE);
    const amazon = createProvider(MetadataProviderKey.AMAZON);
    const openLibrary = createProvider(MetadataProviderKey.OPEN_LIBRARY);
    const registry = new ProviderRegistry([google, amazon, openLibrary]);

    const selected = registry.select([MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE]);

    expect(selected).toEqual([google, openLibrary]);
  });

  it('throws for unknown providers and includes all unknown keys in the message', () => {
    const registry = new ProviderRegistry([createProvider(MetadataProviderKey.GOOGLE)]);

    expect(() => registry.select([MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER, MetadataProviderKey.AMAZON])).toThrow(
      new BadRequestException('Unknown providers: hardcover, amazon'),
    );
  });

  it('finds a provider by key', () => {
    const google = createProvider(MetadataProviderKey.GOOGLE);
    const registry = new ProviderRegistry([google]);

    expect(registry.find(MetadataProviderKey.GOOGLE)).toBe(google);
    expect(registry.find(MetadataProviderKey.AMAZON)).toBeUndefined();
  });
});
