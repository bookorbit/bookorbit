import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuthorMetadataProviderKey } from '@projectx/types';

import { AUTHOR_METADATA_PROVIDERS } from './constants';
import { AuthorMetadataProvider } from './providers/author-metadata-provider';

@Injectable()
export class AuthorMetadataProviderRegistry {
  constructor(
    @Inject(AUTHOR_METADATA_PROVIDERS)
    private readonly providers: AuthorMetadataProvider[],
  ) {}

  all(): AuthorMetadataProvider[] {
    return this.providers;
  }

  select(keys?: AuthorMetadataProviderKey[]): AuthorMetadataProvider[] {
    if (keys === undefined) return this.providers;
    if (keys.length === 0) return [];

    const known = new Set(this.providers.map((provider) => provider.key));
    const unknown = keys.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown author metadata providers: ${unknown.join(', ')}`);
    }

    const requested = new Set(keys);
    return this.providers.filter((provider) => requested.has(provider.key));
  }

  find(key: AuthorMetadataProviderKey): AuthorMetadataProvider | undefined {
    return this.providers.find((provider) => provider.key === key);
  }
}
