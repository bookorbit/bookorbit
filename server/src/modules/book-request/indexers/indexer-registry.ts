import { BadRequestException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_INDEXER_CATEGORIES,
  INDEXER_CREDENTIAL_KINDS,
  INDEXER_DEFAULT_BASE_URLS,
  INDEXER_MEDIA_KINDS,
  INDEXER_SEEDS_BACK,
  INDEXER_USES_CATEGORIES,
  type IndexerAdapterDescriptor,
  type IndexerAdapterType,
  type IndexerCategoryMap,
} from '@bookorbit/types';

import { INDEXER_ADAPTERS, type IndexerAdapter } from './indexer-adapter';
import { PluginIndexerAdapter } from './plugins/plugin-host';
import { PluginLoaderService } from './plugins/plugin-loader.service';

/** What an adapter this build no longer has, or one that declares none, searches with. */
const EMPTY_CATEGORIES: IndexerCategoryMap = { ebook: [], audiobook: [], comic: [] };

/**
 * Every adapter this install can use, built-in or loaded from disk.
 *
 * A map rather than the injected array it used to be, because plugins are discovered at boot and
 * cannot be declared as providers. `require()` still fails loudly on a type nothing provides,
 * which is what should happen when a plugin is removed while rows still name it.
 */
@Injectable()
export class IndexerRegistry implements OnModuleInit {
  private readonly logger = new Logger(IndexerRegistry.name);
  private readonly adapters = new Map<string, IndexerAdapter>();

  constructor(
    @Inject(INDEXER_ADAPTERS) private readonly builtIn: IndexerAdapter[],
    private readonly plugins: PluginLoaderService,
  ) {
    for (const adapter of builtIn) this.adapters.set(adapter.type, adapter);
  }

  async onModuleInit(): Promise<void> {
    for (const adapter of await this.plugins.load()) {
      this.adapters.set(adapter.type, adapter);
    }

    this.logger.log(`[request_indexer.registry] [end] adapters=${this.adapters.size} - indexer adapters registered`);
  }

  /**
   * Adding and dropping an adapter while the process runs is what makes installing or removing a
   * plugin take effect at once. Without it the page keeps listing a plugin whose files are gone,
   * and the only way to act on that list is to restart the server.
   */
  register(adapter: IndexerAdapter): void {
    this.adapters.set(adapter.type, adapter);
    this.logger.log(`[request_indexer.registry] [end] type=${adapter.type} adapters=${this.adapters.size} - adapter registered`);
  }

  /** Built-ins are compiled in, so only a plugin-supplied adapter can be dropped. */
  unregister(type: string): void {
    const adapter = this.adapters.get(type);
    if (!(adapter instanceof PluginIndexerAdapter)) return;

    this.adapters.delete(type);
    this.logger.log(`[request_indexer.registry] [end] type=${type} adapters=${this.adapters.size} - adapter dropped`);
  }

  all(): IndexerAdapter[] {
    return [...this.adapters.values()];
  }

  find(type: IndexerAdapterType | string): IndexerAdapter | undefined {
    return this.adapters.get(type);
  }

  /** Used on every search and grab, so a row whose type was dropped from the build fails loudly. */
  require(type: IndexerAdapterType | string): IndexerAdapter {
    const adapter = this.find(type);
    if (!adapter) throw new BadRequestException(`Unknown indexer type: ${type}`);
    return adapter;
  }

  /**
   * Whether a grab from this adapter joins a swarm. The picker needs it per search, where
   * building the whole descriptor list would be wasteful, so both read the same branch.
   *
   * An adapter this build no longer has claims no swarm. It contributes no releases either, so
   * nothing is displayed on the strength of the answer.
   */
  seedsBack(type: IndexerAdapterType | string): boolean {
    const adapter = this.find(type);
    if (!adapter) return false;
    return adapter instanceof PluginIndexerAdapter ? adapter.plugin.seedsBack : INDEXER_SEEDS_BACK[adapter.type];
  }

  /**
   * The categories a source of this type searches when the operator has not chosen any.
   *
   * Read through the adapter for the same reason `seedsBack` is: a plugin declares its own, and a
   * compile-time map only knows the built-ins. A row saved with no categories used to fall back to
   * nothing at all for every plugin-backed source, which searches every category rather than the
   * ones the plugin said it has.
   */
  defaultCategories(type: IndexerAdapterType | string): IndexerCategoryMap {
    const adapter = this.find(type);
    if (adapter instanceof PluginIndexerAdapter) return adapter.plugin.defaultCategories ?? EMPTY_CATEGORIES;
    if (adapter) return DEFAULT_INDEXER_CATEGORIES[adapter.type];
    return EMPTY_CATEGORIES;
  }

  /**
   * What the settings form needs to render each adapter, so the client stops reading compile-time
   * constants and a plugin-supplied adapter is indistinguishable from a built-in one.
   */
  describe(): IndexerAdapterDescriptor[] {
    return this.all().map((adapter) => (adapter instanceof PluginIndexerAdapter ? describePlugin(adapter) : describeBuiltIn(adapter)));
  }
}

function describeBuiltIn(adapter: IndexerAdapter): IndexerAdapterDescriptor {
  const type = adapter.type;
  return {
    type,
    label: adapter.label,
    builtIn: true,
    requiresCredential: adapter.requiresCredential,
    credentialKind: INDEXER_CREDENTIAL_KINDS[type],
    mediaKinds: [...INDEXER_MEDIA_KINDS[type]],
    usesCategories: INDEXER_USES_CATEGORIES[type],
    seedsBack: INDEXER_SEEDS_BACK[type],
    supportsIsbnSearch: adapter.supportsIsbnSearch,
    defaultCategories: DEFAULT_INDEXER_CATEGORIES[type],
    ...(INDEXER_DEFAULT_BASE_URLS[type] ? { defaultBaseUrl: INDEXER_DEFAULT_BASE_URLS[type] } : {}),
    // Read off the adapter rather than hardcoded empty, so a built-in that declares settings fields
    // gets them the same way a plugin does. Torznab declares none, so today this is always empty.
    settingsFields: [...(adapter.settingsFields ?? [])],
  };
}

/**
 * A plugin carries its own copy of everything a built-in reads from `@bookorbit/types`, because
 * the client cannot have compile-time knowledge of an adapter that arrived at runtime. Its
 * strings are untranslated English: plugin text cannot go through the translation workflow, and
 * the client falls back to these only where it has no message of its own.
 */
function describePlugin(adapter: PluginIndexerAdapter): IndexerAdapterDescriptor {
  const { plugin } = adapter;
  return {
    type: plugin.type as IndexerAdapterType,
    label: plugin.label,
    builtIn: false,
    ...(plugin.version ? { version: plugin.version } : {}),
    requiresCredential: plugin.requiresCredential,
    credentialKind: plugin.credentialKind,
    mediaKinds: [...plugin.mediaKinds],
    usesCategories: plugin.usesCategories,
    seedsBack: plugin.seedsBack,
    // The adapter's, not the plugin's: a plugin may leave the field off entirely.
    supportsIsbnSearch: adapter.supportsIsbnSearch,
    defaultCategories: plugin.defaultCategories ?? { ebook: [], audiobook: [], comic: [] },
    ...(plugin.defaultBaseUrl ? { defaultBaseUrl: plugin.defaultBaseUrl } : {}),
    ...(plugin.baseUrlHint ? { baseUrlHint: plugin.baseUrlHint } : {}),
    settingsFields: [...(plugin.settingsFields ?? [])],
  };
}
