import { Injectable, OnModuleInit } from '@nestjs/common';

import { MetadataCacheProviderCatalog } from '../metadata-cache/metadata-cache-provider-catalog';
import { ProviderRegistry } from './provider-registry';

/** Tells the metadata cache which book providers exist and how each is cached. */
@Injectable()
export class BookProviderCacheRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly catalog: MetadataCacheProviderCatalog,
  ) {}

  onModuleInit(): void {
    this.catalog.register(
      'book',
      this.registry.all().map((provider) => ({ provider: provider.key, label: provider.label, spec: provider.cache })),
    );
  }
}
