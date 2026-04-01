import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { COVER_PROVIDERS } from './constants';
import { COVER_PROVIDER_ALL_KEY, COVER_PROVIDER_KEYS, CoverProvider, CoverProviderKey, DEFAULT_COVER_PROVIDER_KEY } from './providers/cover-provider';

@Injectable()
export class CoverProviderRegistry {
  constructor(
    @Inject(COVER_PROVIDERS)
    private readonly providers: CoverProvider[],
  ) {}

  select(provider?: string): CoverProvider[] {
    const selected = provider?.trim();
    if (!selected) return [this.requireProvider(DEFAULT_COVER_PROVIDER_KEY)];
    if (selected === COVER_PROVIDER_ALL_KEY) return this.providers;
    if (this.isCoverProviderKey(selected)) {
      return [this.requireProvider(selected)];
    }
    throw new BadRequestException(`Unknown cover provider: ${selected}`);
  }

  private isCoverProviderKey(provider: string): provider is CoverProviderKey {
    return COVER_PROVIDER_KEYS.includes(provider as CoverProviderKey);
  }

  private requireProvider(key: CoverProviderKey): CoverProvider {
    const found = this.providers.find((provider) => provider.key === key);
    if (!found) throw new BadRequestException(`Cover provider not registered: ${key}`);
    return found;
  }
}
