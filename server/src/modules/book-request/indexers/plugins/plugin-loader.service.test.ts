import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IndexerCredentialStore } from '../indexer-credential-store';
import { PluginLoaderService } from './plugin-loader.service';

/**
 * A minimal well-formed plugin. Written to disk and imported for real rather than mocked: the
 * whole point of the loader is what happens at the dynamic-import boundary, and a mock of
 * `import()` would test nothing that boundary actually does.
 */
function pluginSource(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    apiVersion: '1',
    version: "'1.2.3'",
    type: "'example-tracker'",
    label: "'Example Tracker'",
    requiresCredential: 'true',
    credentialKind: "'apiKey'",
    mediaKinds: "['ebook']",
    usesCategories: 'true',
    seedsBack: 'true',
    search: 'async () => []',
    test: 'async () => ({ success: true })',
    fetchTorrentFile: 'async () => new Uint8Array([1, 2, 3])',
    ...overrides,
  };
  const body = Object.entries(fields)
    .filter(([, value]) => value !== 'OMIT')
    .map(([key, value]) => `  ${key}: ${value},`)
    .join('\n');
  return `export default {\n${body}\n};\n`;
}

describe('PluginLoaderService', () => {
  let appDataPath: string;
  let loader: PluginLoaderService;
  let credentials: IndexerCredentialStore;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-plugins-'));
    credentials = { rotate: vi.fn() } as unknown as IndexerCredentialStore;
    loader = new PluginLoaderService({ appDataPath } as never, credentials);
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  async function writePlugin(directory: string, source: string, entry = 'index.mjs') {
    const base = join(appDataPath, 'plugins', 'indexers', directory);
    await mkdir(base, { recursive: true });
    // A unique query on the import keeps Node's module cache from serving an earlier test's copy.
    await writeFile(join(base, entry), source, 'utf8');
    return base;
  }

  /** The overwhelmingly common case, and it must not look like an error. */
  it('loads nothing and says nothing when there is no plugin directory', async () => {
    expect(await loader.load()).toEqual([]);
    expect(loader.loadFailures()).toEqual([]);
  });

  it('loads a well-formed plugin and exposes it as an ordinary adapter', async () => {
    await writePlugin('example', pluginSource());

    const [adapter] = await loader.load();

    expect(adapter.type).toBe('example-tracker');
    expect(adapter.label).toBe('Example Tracker');
    expect(adapter.plugin.version).toBe('1.2.3');
    expect(adapter.requiresCredential).toBe(true);
    expect(adapter.mediaKinds).toEqual(['ebook']);
    expect(loader.loadFailures()).toEqual([]);
    expect(loader.directoryForType('example-tracker')).toBe('example');
  });

  it('accepts index.js as well as index.mjs', async () => {
    await writePlugin('example', pluginSource({ type: "'cjs-named'" }), 'index.js');

    expect((await loader.load()).map((adapter) => adapter.type)).toEqual(['cjs-named']);
  });

  /**
   * The failure mode this exists to prevent: a plugin with a typo that simply does not appear,
   * leaving the operator with no way to tell whether it was even seen.
   */
  it('records why a plugin did not load rather than dropping it silently', async () => {
    await writePlugin('broken', 'export default { apiVersion: 1 };\n');

    expect(await loader.load()).toEqual([]);
    expect(loader.loadFailures()).toEqual([{ directory: 'broken', reason: expect.stringContaining('slug') }]);
  });

  it('refuses a plugin built against a different contract version', async () => {
    await writePlugin('old', pluginSource({ apiVersion: '99' }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain('version 99');
  });

  it('keeps loading a legacy plugin that does not declare its own version', async () => {
    await writePlugin('legacy', pluginSource({ version: 'OMIT' }));

    expect(await loader.load()).toHaveLength(1);
    expect(loader.loadFailures()).toEqual([]);
  });

  /** Otherwise a plugin could quietly replace a built-in source with one of its own. */
  it('refuses a plugin that claims a built-in adapter name', async () => {
    await writePlugin('shadow', pluginSource({ type: "'torznab'" }));

    expect(await loader.load()).toEqual([]);
    expect(loader.loadFailures()[0].reason).toContain('already provides');
  });

  it('refuses two plugins claiming the same name', async () => {
    await writePlugin('first', pluginSource({ type: "'duplicated'" }));
    await writePlugin('second', pluginSource({ type: "'duplicated'" }));

    expect(await loader.load()).toHaveLength(1);
    expect(loader.loadFailures()).toHaveLength(1);
  });

  it('refuses a type that is not a slug the adapter_type constraint would accept', async () => {
    await writePlugin('shouty', pluginSource({ type: "'NotASlug'" }));

    expect(loader.loadFailures.length).toBeDefined();
    await loader.load();
    expect(loader.loadFailures()[0].reason).toContain('slug');
  });

  it('refuses a plugin declaring a media kind that does not exist', async () => {
    await writePlugin('odd', pluginSource({ mediaKinds: "['newspaper']" }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain('newspaper');
  });

  /** A release is a torrent or a file. Declaring both leaves the grab path guessing. */
  it('refuses a plugin that declares both a torrent fetch and a file resolve', async () => {
    await writePlugin('both', pluginSource({ resolveFile: 'async () => ({})' }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain('both');
  });

  it('refuses a plugin that declares neither, since nothing it finds could be grabbed', async () => {
    await writePlugin('neither', pluginSource({ fetchTorrentFile: 'OMIT' }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain('neither');
  });

  it('refuses a settings field with no usable key', async () => {
    await writePlugin('fields', pluginSource({ settingsFields: "[{ key: '', type: 'boolean', label: 'x' }]" }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain('settings field');
  });

  it('loads a constrained list settings field', async () => {
    await writePlugin(
      'fields',
      pluginSource({
        settingsFields:
          "[{ key: 'formats', type: 'string', format: 'list', label: 'Formats', default: 'epub,mobi', options: ['epub', 'mobi', 'pdf'], minItems: 1 }]",
      }),
    );

    const [adapter] = await loader.load();

    expect(adapter.settingsFields).toEqual([
      {
        key: 'formats',
        type: 'string',
        format: 'list',
        label: 'Formats',
        default: 'epub,mobi',
        options: ['epub', 'mobi', 'pdf'],
        minItems: 1,
      },
    ]);
  });

  it.each([
    ["[{ key: 'formats', type: 'string', format: 'list', label: 'Formats', options: [] }]", 'non-empty list'],
    ["[{ key: 'formats', type: 'string', format: 'list', label: 'Formats', options: ['epub', 'EPUB'] }]", 'duplicate options'],
    [
      "[{ key: 'formats', type: 'string', format: 'list', label: 'Formats', default: 'wrong', options: ['epub'], minItems: 1 }]",
      'outside its options',
    ],
  ])('refuses an unsafe constrained list declaration', async (settingsFields, reason) => {
    await writePlugin('fields', pluginSource({ settingsFields }));

    await loader.load();

    expect(loader.loadFailures()[0].reason).toContain(reason);
  });

  it('keeps loading the rest after one plugin fails', async () => {
    await writePlugin('broken', 'throw new Error("boom");\n');
    await writePlugin('working', pluginSource({ type: "'still-fine'" }));

    const adapters = await loader.load();

    expect(adapters.map((adapter) => adapter.type)).toEqual(['still-fine']);
    expect(loader.loadFailures().map((failure) => failure.directory)).toEqual(['broken']);
  });

  it('clears stale failures when reloaded', async () => {
    await writePlugin('broken', 'export default {};\n');
    await loader.load();
    expect(loader.loadFailures()).toHaveLength(1);

    await rm(join(appDataPath, 'plugins', 'indexers', 'broken'), { recursive: true, force: true });
    await loader.load();

    expect(loader.loadFailures()).toEqual([]);
  });
});
