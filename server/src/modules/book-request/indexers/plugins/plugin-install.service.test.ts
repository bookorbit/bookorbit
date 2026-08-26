import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEXER_ADAPTER_TYPES } from '@bookorbit/types';

import { PluginInstallService, MAX_PLUGIN_BYTES } from './plugin-install.service';
import { PluginLoaderService } from './plugin-loader.service';
import type { IndexerRegistry } from '../indexer-registry';

/** A plugin that satisfies the contract, with individual fields overridable. */
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

describe('PluginInstallService', () => {
  let appDataPath: string;
  let service: PluginInstallService;
  let loader: PluginLoaderService;
  let registry: { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
  let indexers: { countByAdapterType: ReturnType<typeof vi.fn>; deleteByAdapterType: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-install-'));
    // The real loader, because installing has to produce something it can actually read back.
    loader = new PluginLoaderService({ appDataPath } as never, { rotate: vi.fn() } as never);
    registry = { register: vi.fn(), unregister: vi.fn() };
    indexers = { countByAdapterType: vi.fn().mockResolvedValue(0), deleteByAdapterType: vi.fn().mockResolvedValue(0) };
    service = new PluginInstallService({ appDataPath } as never, registry as unknown as IndexerRegistry, loader, indexers as never);
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  const installed = (type: string) => join(appDataPath, 'plugins', 'indexers', type, 'index.mjs');

  describe('inspect', () => {
    it('reports what a plugin declares about itself', async () => {
      await expect(service.inspect(pluginSource())).resolves.toMatchObject({
        type: 'example-tracker',
        label: 'Example Tracker',
        version: '1.2.3',
        requiresCredential: true,
        credentialKind: 'apiKey',
        mediaKinds: ['ebook'],
        usesCategories: true,
        seedsBack: true,
        replaces: false,
      });
    });

    /** One dependency-free file is what makes reading it before trusting it realistic. */
    it('hands the source back so it can be read before it is run', async () => {
      const source = pluginSource();

      await expect(service.inspect(source)).resolves.toMatchObject({ source });
    });

    it('reads the optional fields the settings form needs', async () => {
      const source = pluginSource({
        defaultBaseUrl: "'https://tracker.example'",
        baseUrlHint: "'The tracker address'",
        settingsFields:
          "[{ key: 'formats', type: 'string', format: 'list', label: 'Formats', default: 'epub', options: ['epub', 'pdf'], minItems: 1 }]",
      });

      await expect(service.inspect(source)).resolves.toMatchObject({
        defaultBaseUrl: 'https://tracker.example',
        baseUrlHint: 'The tracker address',
        settingsFields: [
          {
            key: 'formats',
            type: 'string',
            format: 'list',
            label: 'Formats',
            default: 'epub',
            options: ['epub', 'pdf'],
            minItems: 1,
          },
        ],
      });
    });

    /** Nothing is kept, so an operator can look at a file without committing to it. */
    it('writes nothing while inspecting', async () => {
      await service.inspect(pluginSource());

      await expect(readFile(installed('example-tracker'), 'utf8')).rejects.toThrow();
    });

    it('says when an install would replace one already there', async () => {
      await service.install(pluginSource(), 'someone');

      await expect(service.inspect(pluginSource())).resolves.toMatchObject({ replaces: true });
    });

    it.each([
      ['a different contract version', { apiVersion: '99' }, /version/i],
      ['an invalid plugin version', { version: "'next'" }, /semantic version/i],
      ['no label', { label: "''" }, /label/i],
      ['no search function', { search: 'OMIT' }, /search/i],
      ['no test function', { test: 'OMIT' }, /test/i],
      ['no media kinds', { mediaKinds: '[]' }, /media kinds/i],
      ['a media kind that is not one', { mediaKinds: "['newspaper']" }, /newspaper/i],
      ['a type that is not a slug', { type: "'SHOUTY'" }, /slug/i],
      ['both grab methods', { resolveFile: 'async () => ({})' }, /both/i],
      ['neither grab method', { fetchTorrentFile: 'OMIT' }, /neither/i],
      ['an unusable settings field', { settingsFields: "[{ type: 'boolean', label: 'x' }]" }, /settings field/i],
    ])('refuses a plugin with %s', async (_case, overrides, message) => {
      await expect(service.inspect(pluginSource(overrides))).rejects.toThrow(message);
    });

    it('accepts a legacy plugin that does not declare its own version', async () => {
      await expect(service.inspect(pluginSource({ version: 'OMIT' }))).resolves.not.toHaveProperty('version');
    });

    /** It would be refused at the next boot and simply not appear, which is a worse way to learn. */
    it('refuses a plugin claiming a built-in name', async () => {
      await expect(service.inspect(pluginSource({ type: "'torznab'" }))).rejects.toThrow(/already provides/i);
    });

    it('refuses a file that is not a module at all', async () => {
      await expect(service.inspect('this is not javascript {{{')).rejects.toThrow(/could not be read/i);
    });

    it('refuses a module with no default export', async () => {
      await expect(service.inspect('export const nope = 1;\n')).rejects.toThrow(/not a usable plugin/i);
    });

    it('refuses an empty file', async () => {
      await expect(service.inspect('')).rejects.toThrow(/empty/i);
    });

    it('refuses a file past the size cap', async () => {
      const huge = `// ${'x'.repeat(MAX_PLUGIN_BYTES)}\n${pluginSource()}`;

      await expect(service.inspect(huge)).rejects.toThrow(/limit/i);
    });

    /**
     * Evaluating a module runs its top-level code. Reading it in a child process is what keeps a
     * plugin that never finishes loading from taking this one with it.
     */
    it('gives up on a file that never finishes loading', async () => {
      const wedged = `await new Promise(() => {});\n${pluginSource()}`;

      await expect(service.inspect(wedged)).rejects.toThrow(/did not finish loading/i);
    }, 20000);

    it('repeats why a plugin threw on import rather than saying it failed', async () => {
      await expect(service.inspect("throw new Error('deliberate failure inside the plugin');\n")).rejects.toThrow(/deliberate failure/i);
    });

    /** A plugin should not be able to read this process's environment while being looked at. */
    it('inspects with none of the environment this process holds', async () => {
      process.env.BOOKORBIT_TEST_SECRET = 'must-not-leak';
      try {
        const nosy = pluginSource({ label: 'process.env.BOOKORBIT_TEST_SECRET ?? "saw nothing"' });

        await expect(service.inspect(nosy)).resolves.toMatchObject({ label: 'saw nothing' });
      } finally {
        delete process.env.BOOKORBIT_TEST_SECRET;
      }
    });

    /** A module that blocks the event loop is killed; one that simply never settles exits at once. */
    it('gives up on a file that blocks rather than resolving', async () => {
      const blocked = `await new Promise((resolve) => setTimeout(resolve, 60_000));\n${pluginSource()}`;

      await expect(service.inspect(blocked)).rejects.toThrow(/did not finish loading/i);
    }, 20000);
  });

  describe('install', () => {
    it('writes the plugin where the loader will find it', async () => {
      const source = pluginSource();

      await service.install(source, 'someone');

      await expect(readFile(installed('example-tracker'), 'utf8')).resolves.toBe(source);
    });

    it('names the directory after the type the plugin declares, not the upload', async () => {
      await service.install(pluginSource({ type: "'chosen-name'" }), 'someone');

      await expect(readFile(installed('chosen-name'), 'utf8')).resolves.toContain('chosen-name');
    });

    /** Checked again on install, so what was reviewed and what lands cannot differ. */
    it('refuses on install what it would refuse on inspection', async () => {
      await expect(service.install(pluginSource({ apiVersion: '99' }), 'someone')).rejects.toThrow(/version/i);
      await expect(readFile(installed('example-tracker'), 'utf8')).rejects.toThrow();
    });

    it('replaces a plugin of the same type rather than adding a second', async () => {
      await service.install(pluginSource(), 'someone');
      await service.install(pluginSource({ label: "'Renamed'" }), 'someone');

      await expect(readFile(installed('example-tracker'), 'utf8')).resolves.toContain('Renamed');
    });
  });

  describe('remove', () => {
    it('deletes an installed plugin', async () => {
      await service.install(pluginSource(), 'someone');

      await service.remove('example-tracker', 'someone');

      await expect(readFile(installed('example-tracker'), 'utf8')).rejects.toThrow();
    });

    it('deletes every source configured for the plugin', async () => {
      await service.install(pluginSource(), 'someone');
      indexers.deleteByAdapterType.mockResolvedValue(3);

      await service.remove('example-tracker', 'someone');

      expect(indexers.deleteByAdapterType).toHaveBeenCalledWith('example-tracker');
    });

    it('deletes a disk-installed plugin whose directory differs from its declared type', async () => {
      const directory = join(appDataPath, 'plugins', 'indexers', 'manual-install');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'index.js'), pluginSource(), 'utf8');
      await loader.load();

      await service.remove('example-tracker', 'someone');

      await expect(readFile(join(directory, 'index.js'), 'utf8')).rejects.toThrow();
      expect(indexers.deleteByAdapterType).toHaveBeenCalledWith('example-tracker');
    });

    it('deletes a broken plugin directory whose name is not an adapter slug', async () => {
      const directory = join(appDataPath, 'plugins', 'indexers', 'Broken Plugin');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'index.mjs'), 'export default {};\n', 'utf8');
      await loader.load();

      await service.remove('Broken Plugin', 'someone');

      await expect(readFile(join(directory, 'index.mjs'), 'utf8')).rejects.toThrow();
      expect(indexers.deleteByAdapterType).not.toHaveBeenCalled();
      expect(loader.loadFailures()).toEqual([]);
    });

    it('deletes sources left behind by an earlier plugin removal', async () => {
      indexers.countByAdapterType.mockResolvedValue(2);
      indexers.deleteByAdapterType.mockResolvedValue(2);

      await service.remove('example-tracker', 'someone');

      expect(indexers.deleteByAdapterType).toHaveBeenCalledWith('example-tracker');
      expect(registry.unregister).toHaveBeenCalledWith('example-tracker');
    });

    it('keeps the plugin installed when its sources could not be deleted', async () => {
      await service.install(pluginSource(), 'someone');
      indexers.countByAdapterType.mockResolvedValue(1);
      indexers.deleteByAdapterType.mockRejectedValue(new Error('database unavailable'));

      await expect(service.remove('example-tracker', 'someone')).rejects.toThrow('database unavailable');

      await expect(readFile(installed('example-tracker'), 'utf8')).resolves.toContain('example-tracker');
      expect(registry.unregister).not.toHaveBeenCalled();
    });

    /** The count answers "does this exist", so nothing is deleted on the way to finding out it does not. */
    it('refuses when neither a plugin nor one of its sources exists, without deleting anything', async () => {
      await expect(service.remove('never-installed', 'someone')).rejects.toThrow(/no plugin/i);
      expect(indexers.countByAdapterType).toHaveBeenCalledWith('never-installed');
      expect(indexers.deleteByAdapterType).not.toHaveBeenCalled();
    });

    /**
     * A built-in adapter name is a valid plugin slug on shape alone, so nothing else in `remove`
     * would have stopped this: the delete runs first, existing rows make the call succeed, and
     * every torznab source on the instance is gone along with its encrypted credential.
     */
    it.each([...INDEXER_ADAPTER_TYPES])('refuses to uninstall the built-in %s adapter', async (type) => {
      await expect(service.remove(type, 'someone')).rejects.toThrow(/built into this install/i);
      expect(indexers.countByAdapterType).not.toHaveBeenCalled();
      expect(indexers.deleteByAdapterType).not.toHaveBeenCalled();
      expect(registry.unregister).not.toHaveBeenCalled();
    });

    /** The type is a slug by the time it gets here, but the cost of being wrong is a write outside. */
    it.each(['../../../etc', 'a/b', '..'])('refuses %s as a plugin name', async (type) => {
      await expect(service.remove(type, 'someone')).rejects.toThrow();
      expect(indexers.deleteByAdapterType).not.toHaveBeenCalled();
    });

    it('leaves a neighbouring plugin alone', async () => {
      await service.install(pluginSource(), 'someone');
      await service.install(pluginSource({ type: "'other-one'" }), 'someone');

      await service.remove('example-tracker', 'someone');

      await expect(readFile(installed('other-one'), 'utf8')).resolves.toContain('other-one');
    });
  });

  /**
   * A plugin has to be usable the moment it is installed. Without this the settings page keeps
   * listing what was just removed and hides what was just added, and the only cure is a restart.
   */
  describe('taking effect without a restart', () => {
    it('registers the adapter it just wrote', async () => {
      const result = await service.install(pluginSource(), 'someone');

      expect(result.active).toBe(true);
      expect(registry.register).toHaveBeenCalledWith(expect.objectContaining({ type: 'example-tracker' }));
    });

    it('drops the adapter it just deleted', async () => {
      await service.install(pluginSource(), 'someone');

      await service.remove('example-tracker', 'someone');

      expect(registry.unregister).toHaveBeenCalledWith('example-tracker');
    });

    /** Node caches a module by URL, so a replacement has to come back as the new code, not the old. */
    it('registers the replacement rather than the code it replaced', async () => {
      await service.install(pluginSource(), 'someone');
      registry.register.mockClear();

      await service.install(pluginSource({ label: "'Renamed'" }), 'someone');

      const registered = registry.register.mock.calls.at(-1)?.[0] as { plugin: { label: string } };
      expect(registered.plugin.label).toBe('Renamed');
    });

    /**
     * The file is written before it is loaded here, so a module that will not load in this process
     * still landed. Saying so beats failing an install that did happen.
     */
    it('reports a plugin that landed but would not load', async () => {
      vi.spyOn(loader, 'loadDirectory').mockRejectedValueOnce(new Error('nope'));

      const result = await service.install(pluginSource(), 'someone');

      expect(result.active).toBe(false);
      await expect(readFile(installed('example-tracker'), 'utf8')).resolves.toContain('example-tracker');
    });
  });

  /** What the installer writes has to be what the loader reads, or the two rule sets have drifted. */
  it('installs something the loader then loads', async () => {
    await service.install(pluginSource(), 'someone');

    const adapters = await loader.load();

    expect(adapters.map((adapter) => adapter.type)).toEqual(['example-tracker']);
    expect(loader.loadFailures()).toEqual([]);
  });
});
