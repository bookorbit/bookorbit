import { BadRequestException } from '@nestjs/common';
import { ConcreteBookMediaKind, MetadataProviderKey } from '@bookorbit/types';

import { ProviderRegistry } from './provider-registry';
import { MetadataProvider } from './providers/metadata-provider';

function createProvider(key: MetadataProviderKey, label = key, mediaKinds?: readonly ConcreteBookMediaKind[]): MetadataProvider {
  return {
    key,
    label,
    identifiable: false,
    ...(mediaKinds ? { mediaKinds } : {}),
    search: vi.fn().mockResolvedValue([]),
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

  it('keeps providers that declare no media kinds, so a new provider is never scoped out silently', () => {
    const registry = new ProviderRegistry([
      createProvider(MetadataProviderKey.GOOGLE),
      createProvider(MetadataProviderKey.COMICVINE, 'ComicVine', ['comic']),
      createProvider(MetadataProviderKey.AUDIBLE, 'Audible', ['audiobook']),
    ]);

    expect(registry.keysForMediaKind([MetadataProviderKey.GOOGLE, MetadataProviderKey.COMICVINE, MetadataProviderKey.AUDIBLE], 'ebook')).toEqual([
      MetadataProviderKey.GOOGLE,
    ]);
  });

  it('keeps a specialist only for the medium it serves', () => {
    const registry = new ProviderRegistry([
      createProvider(MetadataProviderKey.GOOGLE),
      createProvider(MetadataProviderKey.COMICVINE, 'ComicVine', ['comic']),
      createProvider(MetadataProviderKey.AUDIBLE, 'Audible', ['audiobook']),
    ]);
    const keys = [MetadataProviderKey.GOOGLE, MetadataProviderKey.COMICVINE, MetadataProviderKey.AUDIBLE];

    expect(registry.keysForMediaKind(keys, 'comic')).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.COMICVINE]);
    expect(registry.keysForMediaKind(keys, 'audiobook')).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.AUDIBLE]);
  });

  it('leaves an unregistered key alone rather than masking it as a scoped-out provider', () => {
    const registry = new ProviderRegistry([createProvider(MetadataProviderKey.GOOGLE)]);

    // select() is what rejects an unknown key; swallowing it here would turn that error into an empty search.
    expect(registry.keysForMediaKind([MetadataProviderKey.GOOGLE, MetadataProviderKey.HARDCOVER], 'ebook')).toEqual([
      MetadataProviderKey.GOOGLE,
      MetadataProviderKey.HARDCOVER,
    ]);
  });

  it('finds a provider by key', () => {
    const google = createProvider(MetadataProviderKey.GOOGLE);
    const registry = new ProviderRegistry([google]);

    expect(registry.find(MetadataProviderKey.GOOGLE)).toBe(google);
    expect(registry.find(MetadataProviderKey.AMAZON)).toBeUndefined();
  });
});
