import { BadRequestException, Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConcreteBookMediaKind, CoverMedia, isBuiltInMetadataProviderKey, MetadataProviderKey } from '@bookorbit/types';

import { HttpProviderClient } from '../metadata-http-provider/http-provider.client';
import { MetadataHttpProviderCatalog } from '../metadata-http-provider/metadata-http-provider.catalog';
import { METADATA_PROVIDERS } from './constants';
import { HttpMetadataProvider } from './providers/http/http-metadata-provider';
import { MetadataProvider } from './providers/metadata-provider';

/**
 * Every provider a search can ask: the built-ins compiled in, then the external providers an admin
 * registered, rebuilt whenever that catalog changes. Callers read it per call, so an external
 * provider takes part from the moment it is enabled, with no restart.
 */
@Injectable()
export class ProviderRegistry implements OnModuleDestroy {
  private providers: MetadataProvider[];
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(
    @Inject(METADATA_PROVIDERS)
    private readonly builtIns: MetadataProvider[],
    @Optional() private readonly httpCatalog?: MetadataHttpProviderCatalog,
    @Optional() private readonly httpClient?: HttpProviderClient,
  ) {
    this.providers = builtIns;
    this.rebuild();
    this.unsubscribe = this.httpCatalog?.onChange(() => this.rebuild()) ?? (() => undefined);
  }

  onModuleDestroy(): void {
    this.unsubscribe();
  }

  all(): MetadataProvider[] {
    return this.providers;
  }

  /** Called after the provider list changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isExternal(key: MetadataProviderKey): boolean {
    return !isBuiltInMetadataProviderKey(key) && this.find(key) !== undefined;
  }

  private rebuild(): void {
    const { httpCatalog, httpClient } = this;
    if (!httpCatalog || !httpClient) return;
    const builtInKeys = new Set(this.builtIns.map((provider) => provider.key));
    // A duplicate key in the provider list crashes released iOS builds, so a built-in always wins.
    const external = httpCatalog
      .active()
      .filter((provider) => !builtInKeys.has(provider.key))
      .map((provider) => new HttpMetadataProvider(provider, httpClient));
    this.providers = external.length > 0 ? [...this.builtIns, ...external] : this.builtIns;
    for (const listener of this.listeners) listener();
  }

  select(keys?: MetadataProviderKey[]): MetadataProvider[] {
    if (keys === undefined) return this.providers;
    if (keys.length === 0) return [];
    const known = new Set(this.providers.map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw new BadRequestException(`Unknown providers: ${unknown.join(', ')}`);
    const requested = new Set(keys);
    return this.providers.filter((p) => requested.has(p.key));
  }

  find(key: MetadataProviderKey): MetadataProvider | undefined {
    return this.providers.find((p) => p.key === key);
  }

  /**
   * Narrows keys to the providers worth asking about for one medium. A provider that declares no
   * media kinds serves all of them, so this drops specialists rather than keeping a whitelist.
   */
  keysForMediaKind(keys: MetadataProviderKey[], mediaKind: ConcreteBookMediaKind): MetadataProviderKey[] {
    return keys.filter((key) => {
      const mediaKinds = this.find(key)?.mediaKinds;
      return !mediaKinds || mediaKinds.includes(mediaKind);
    });
  }

  /**
   * Narrows keys to the providers that can answer for a book with these media. Cover media fold
   * comics into ebooks, and a comic can sit in any ebook container, so comic specialists stay
   * eligible wherever there is an ebook.
   */
  keysForMedia(keys: MetadataProviderKey[], media: CoverMedia): MetadataProviderKey[] {
    const kinds: ConcreteBookMediaKind[] = [];
    if (media.hasEbook) kinds.push('ebook', 'comic');
    if (media.hasAudio) kinds.push('audiobook');
    return keys.filter((key) => {
      const mediaKinds = this.find(key)?.mediaKinds;
      return !mediaKinds || mediaKinds.some((kind) => kinds.includes(kind));
    });
  }

  /** A provider that serves nothing but audiobooks, so a book without audio never needs it. */
  servesOnlyAudiobooks(key: MetadataProviderKey): boolean {
    const mediaKinds = this.find(key)?.mediaKinds;
    return mediaKinds !== undefined && mediaKinds.length > 0 && mediaKinds.every((kind) => kind === 'audiobook');
  }

  editionFollowsMedium(key: MetadataProviderKey): boolean {
    return this.find(key)?.editionFollowsMedium === true;
  }
}
