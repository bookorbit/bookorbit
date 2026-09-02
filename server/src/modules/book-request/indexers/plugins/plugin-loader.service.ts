import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { IndexerPlugin } from '@bookorbit/plugin-api';
import { INDEXER_ADAPTER_TYPES } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { storageConfig } from '../../../../config/config';
import { IndexerCredentialStore } from '../indexer-credential-store';
import { PluginIndexerAdapter } from './plugin-host';
import { assertPluginShape } from './plugin-shape';

/** Where an operator drops a plugin. Writable in the container, and survives an upgrade. */
const PLUGIN_SUBDIRECTORY = join('plugins', 'indexers');
const ENTRYPOINTS = ['index.mjs', 'index.js'];

/** A plugin that would not load, kept so the settings page can say which file and why. */
export interface PluginLoadFailure {
  directory: string;
  reason: string;
}

/**
 * Imports an ES module from an absolute `file://` URL, in both of the environments this runs in.
 *
 * The server is built as CommonJS by swc, which rewrites a plain `import()` into `require()` -
 * and `require()` cannot load an ES module, so every plugin fails with "Cannot find module"
 * naming a `file://` URL. That only happens in a built server: Vitest runs the source as ESM,
 * where the plain import is exactly right and the `Function` form fails instead, because its
 * compiled code has no import callback.
 *
 * So try the real thing first and keep the indirection as the fallback. Whichever environment
 * this is, one of the two works, and neither needs a build-config flag that a running watcher
 * would have to be restarted to notice.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- needed to preserve runtime dynamic import in CJS output
const importViaFunction = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;

async function importModule(specifier: string): Promise<unknown> {
  try {
    return await (import(specifier) as Promise<unknown>);
  } catch {
    return await importViaFunction(specifier);
  }
}

/**
 * Loads indexer plugins from disk at boot.
 *
 * BookOrbit ships no plugins. This is the seam that lets a tracker adapter live in somebody
 * else's repository instead of this one, which is the whole point of the exercise: the code that
 * knows about a particular tracker is not code this project distributes.
 *
 * A plugin runs in this process with this process's reach. That is the accepted trade for a
 * self-hosted application, the same one Jellyfin and Home Assistant make, and it is stated in the
 * install documentation rather than left to be discovered. What the loader can do it does: it
 * refuses a plugin that would shadow a built-in adapter, refuses one built against a different
 * contract version, and records a failure instead of letting a broken plugin vanish silently.
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly failures: PluginLoadFailure[] = [];
  private readonly directoriesByType = new Map<string, string>();

  constructor(
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
    private readonly credentials: IndexerCredentialStore,
  ) {}

  get root(): string {
    return join(this.storage.appDataPath, PLUGIN_SUBDIRECTORY);
  }

  /** Everything that failed to load, so the settings page can explain a plugin that is missing. */
  loadFailures(): readonly PluginLoadFailure[] {
    return this.failures;
  }

  /** Dropped when a directory is removed or reinstalled, so a fixed plugin stops being reported. */
  forgetFailure(directory: string): void {
    const at = this.failures.findIndex((failure) => failure.directory === directory);
    if (at !== -1) this.failures.splice(at, 1);
  }

  directoryForType(type: string): string | undefined {
    return this.directoriesByType.get(type);
  }

  forgetPlugin(type: string): void {
    this.directoriesByType.delete(type);
  }

  async load(): Promise<PluginIndexerAdapter[]> {
    this.failures.length = 0;
    this.directoriesByType.clear();

    let directories: string[];
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      // No plugin directory at all is the normal case, not a problem worth logging.
      return [];
    }

    const started = Date.now();
    const adapters: PluginIndexerAdapter[] = [];
    const claimed = new Set<string>(INDEXER_ADAPTER_TYPES);

    for (const directory of directories.sort()) {
      try {
        const adapter = new PluginIndexerAdapter(await this.loadOne(directory), this.credentials);
        if (claimed.has(adapter.type)) {
          throw new Error(`another adapter already provides "${adapter.type}"`);
        }
        claimed.add(adapter.type);
        this.directoriesByType.set(adapter.type, directory);
        adapters.push(adapter);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failures.push({ directory, reason });
        this.logger.warn(
          `[request_indexer.plugin_load] [fail] directory="${sanitizeLogValue(directory)}" error="${sanitizeLogValue(reason)}" - plugin not loaded`,
        );
      }
    }

    this.logger.log(
      `[request_indexer.plugin_load] [end] loaded=${adapters.length} failed=${this.failures.length} durationMs=${Date.now() - started} - scanned the plugin directory`,
    );
    return adapters;
  }

  /**
   * Loads one directory, so installing a plugin can put it to work without a restart rather than
   * only writing it to disk and asking the operator to come back later.
   */
  async loadDirectory(directory: string): Promise<PluginIndexerAdapter> {
    const plugin = await this.loadOne(directory);
    this.directoriesByType.set(plugin.type, directory);
    this.logger.log(`[request_indexer.plugin_load] [end] directory="${sanitizeLogValue(directory)}" type=${plugin.type} - plugin loaded`);
    return new PluginIndexerAdapter(plugin, this.credentials);
  }

  private async loadOne(directory: string): Promise<IndexerPlugin> {
    const base = resolve(this.root, directory);
    // A plugin directory is named, never traversed into from outside its own root.
    if (!base.startsWith(resolve(this.root) + '/')) throw new Error('that plugin path escapes the plugin directory');

    const entry = await this.findEntrypoint(base);
    if (!entry) throw new Error(`no ${ENTRYPOINTS.join(' or ')} in that directory`);

    // Node caches a module by URL for the life of the process, so a plugin reinstalled over its own
    // path would keep serving the code that was just replaced. The query makes each load a new URL.
    const url = `${pathToFileURL(entry).href}?loaded=${Date.now()}`;
    const module = (await importModule(url)) as { default?: unknown };
    const plugin = module.default;
    if (!plugin || typeof plugin !== 'object') throw new Error('the module has no default export');

    assertPluginShape({
      ...(plugin as Partial<IndexerPlugin>),
      hasSearch: typeof (plugin as Partial<IndexerPlugin>).search === 'function',
      hasTest: typeof (plugin as Partial<IndexerPlugin>).test === 'function',
      hasResolveFile: typeof (plugin as Partial<IndexerPlugin>).resolveFile === 'function',
      hasFetchTorrentFile: typeof (plugin as Partial<IndexerPlugin>).fetchTorrentFile === 'function',
    });
    return plugin as IndexerPlugin;
  }

  private async findEntrypoint(base: string): Promise<string | null> {
    for (const name of ENTRYPOINTS) {
      const candidate = join(base, name);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }
}
