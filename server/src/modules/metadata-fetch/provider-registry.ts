import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConcreteBookMediaKind, MetadataProviderKey } from '@bookorbit/types';

import { METADATA_PROVIDERS } from './constants';
import { MetadataProvider } from './providers/metadata-provider';

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(METADATA_PROVIDERS)
    private readonly providers: MetadataProvider[],
  ) {}

  all(): MetadataProvider[] {
    return this.providers;
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
}
