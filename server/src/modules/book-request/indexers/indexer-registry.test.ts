import type { IndexerPlugin } from '@bookorbit/plugin-api';

import { IndexerRegistry } from './indexer-registry';
import { PluginIndexerAdapter } from './plugins/plugin-host';

function plugin(): IndexerPlugin {
  return {
    apiVersion: 1,
    version: '2.4.1',
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

    expect(registry.describe()).toContainEqual(expect.objectContaining({ type: 'example-tracker', version: '2.4.1' }));
  });
});
