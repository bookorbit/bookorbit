import { Injectable } from '@nestjs/common';
import type { MetadataCacheNamespace, MetadataCacheProviderInfo } from '@bookorbit/types';

import type { ProviderCacheSpec } from '../../common/provider-cache/provider-cache-spec';

export interface CatalogEntry {
  namespace: MetadataCacheNamespace;
  provider: string;
  label: string;
  spec?: ProviderCacheSpec<unknown>;
}

/**
 * The providers each namespace has registered. Lets the cache validate overrides, find orphaned
 * entries, and describe providers to the settings page without depending on either provider module.
 */
@Injectable()
export class MetadataCacheProviderCatalog {
  private readonly entries = new Map<string, CatalogEntry>();

  register(namespace: MetadataCacheNamespace, providers: readonly Omit<CatalogEntry, 'namespace'>[]): void {
    for (const provider of providers) {
      this.entries.set(catalogKey(namespace, provider.provider), { ...provider, namespace });
    }
  }

  /** A provider registered at runtime can leave again; its cached rows then become orphans the sweeper drops. */
  unregister(namespace: MetadataCacheNamespace, provider: string): void {
    this.entries.delete(catalogKey(namespace, provider));
  }

  get(namespace: MetadataCacheNamespace, provider: string): CatalogEntry | undefined {
    return this.entries.get(catalogKey(namespace, provider));
  }

  has(namespace: MetadataCacheNamespace, provider: string): boolean {
    return this.entries.has(catalogKey(namespace, provider));
  }

  list(): CatalogEntry[] {
    return [...this.entries.values()];
  }

  describe(): MetadataCacheProviderInfo[] {
    return this.list().map((entry) => ({
      namespace: entry.namespace,
      provider: entry.provider,
      label: entry.label,
      cacheable: entry.spec !== undefined,
      cachesEmptyResults: entry.spec?.trustEmpty === true,
    }));
  }
}

function catalogKey(namespace: MetadataCacheNamespace, provider: string): string {
  return `${namespace}:${provider}`;
}
