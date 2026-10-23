import type { IndexerPlugin } from '@bookorbit/plugin-api';

import { IndexerRegistry } from './indexer-registry';
import { PluginIndexerAdapter } from './plugins/plugin-host';

function plugin(): IndexerPlugin {
  return {
    apiVersion: 1,
    version: '2.4.1',
    update: { manifestUrl: 'https://updates.example/example.json', ed25519PublicKey: 'a'.repeat(43) },
    type: 'example-tracker',
    label: 'Example Tracker',
    requiresCredential: false,
    credentialKind: null,
    mediaKinds: ['ebook'],
    usesCategories: false,
    seedsBack: false,
    search: () => Promise.resolve([]),
    test: () => Promise.resolve({ success: true }),
    resolveFile: () => Promise.resolve({ url: 'https://example.com/book.epub', fileName: 'book.epub', sizeBytes: null, format: 'epub' }),
  };
}

describe('IndexerRegistry', () => {
  it('includes a plugin release version in its client descriptor', () => {
    const registry = new IndexerRegistry([], { load: vi.fn() } as never);
    registry.register(new PluginIndexerAdapter(plugin(), { rotate: vi.fn() } as never));

    expect(registry.describe()).toContainEqual(expect.objectContaining({ type: 'example-tracker', version: '2.4.1', updateable: true }));
  });

  /** An older plugin still lists comics; none of that may reach a descriptor or an indexer row. */
  it('drops the retired comic medium and its categories from a plugin that still declares them', () => {
    const older = {
      ...plugin(),
      usesCategories: true,
      mediaKinds: ['ebook', 'comic'],
      defaultCategories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    } as unknown as IndexerPlugin;
    const registry = new IndexerRegistry([], { load: vi.fn() } as never);
    const adapter = new PluginIndexerAdapter(older, { rotate: vi.fn() } as never);
    registry.register(adapter);

    const descriptor = registry.describe().find((entry) => entry.type === 'example-tracker');
    expect(descriptor?.mediaKinds).toEqual(['ebook']);
    expect(descriptor?.defaultCategories).toEqual({ ebook: [7020], audiobook: [3030] });
    expect(registry.defaultCategories('example-tracker')).toEqual({ ebook: [7020], audiobook: [3030] });
    expect(adapter.mediaKinds).toEqual(['ebook']);
  });
});
