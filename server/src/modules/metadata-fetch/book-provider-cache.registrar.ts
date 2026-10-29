import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { MetadataCacheProviderCatalog } from '../metadata-cache/metadata-cache-provider-catalog';
import { ProviderRegistry } from './provider-registry';

/**
 * Tells the metadata cache which book providers exist and how each is cached, and keeps telling it
 * as external providers are enabled, changed and removed at runtime.
 */
@Injectable()
export class BookProviderCacheRegistrar implements OnModuleInit, OnModuleDestroy {
  private registered = new Set<string>();
  private unsubscribe: () => void = () => undefined;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly catalog: MetadataCacheProviderCatalog,
  ) {}

  onModuleInit(): void {
    this.sync();
    this.unsubscribe = this.registry.onChange(() => this.sync());
  }

  onModuleDestroy(): void {
    this.unsubscribe();
  }

  private sync(): void {
    const providers = this.registry.all();
    const current = new Set(providers.map((provider) => provider.key as string));
    for (const key of this.registered) {
      if (!current.has(key)) this.catalog.unregister('book', key);
    }
    this.catalog.register(
      'book',
      providers.map((provider) => ({ provider: provider.key, label: provider.label, spec: provider.cache })),
    );
    this.registered = current;
  }
}
