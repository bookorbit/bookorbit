import { BadRequestException } from '@nestjs/common';

import { AuthorMetadataProviderRegistry } from './provider-registry';

describe('AuthorMetadataProviderRegistry', () => {
  function makeRegistry() {
    const providers = [
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: true,
        search: vi.fn(),
      },
      {
        key: 'custom',
        label: 'Custom',
        identifiable: false,
        search: vi.fn(),
      },
    ];
    return {
      providers,
      registry: new AuthorMetadataProviderRegistry(providers as never, { register: vi.fn() } as never),
    };
  }

  it('returns all registered providers by default', () => {
    const { registry, providers } = makeRegistry();

    expect(registry.all()).toEqual(providers);
    expect(registry.select()).toEqual(providers);
  });

  it('returns empty list when no keys are requested', () => {
    const { registry } = makeRegistry();
    expect(registry.select([])).toEqual([]);
  });

  it('selects only requested providers in registration order', () => {
    const { registry } = makeRegistry();

    expect(registry.select(['custom', 'audnexus'] as never)).toEqual([
      expect.objectContaining({ key: 'audnexus' }),
      expect.objectContaining({ key: 'custom' }),
    ]);
  });

  it('throws BadRequestException for unknown provider keys', () => {
    const { registry } = makeRegistry();

    expect(() => registry.select(['missing'] as never)).toThrow(BadRequestException);
  });

  it('find returns provider by key or undefined', () => {
    const { registry } = makeRegistry();

    expect(registry.find('audnexus' as never)).toEqual(expect.objectContaining({ key: 'audnexus' }));
    expect(registry.find('missing' as never)).toBeUndefined();
  });

  it('registers every provider and its cache declaration with the metadata cache catalog', () => {
    const spec = { version: 1, trustEmpty: true };
    const providers = [
      { key: 'audnexus', label: 'Audnexus', identifiable: true, cache: spec, search: vi.fn() },
      { key: 'goodreads', label: 'Goodreads', identifiable: true, search: vi.fn() },
    ];
    const catalog = { register: vi.fn() };
    const registry = new AuthorMetadataProviderRegistry(providers as never, catalog as never);

    registry.onModuleInit();

    expect(catalog.register).toHaveBeenCalledWith('author', [
      { provider: 'audnexus', label: 'Audnexus', spec },
      { provider: 'goodreads', label: 'Goodreads', spec: undefined },
    ]);
  });
});
