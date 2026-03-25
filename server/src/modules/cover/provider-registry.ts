import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { COVER_PROVIDERS } from './constants';
import { CoverProvider, CoverProviderKey } from './providers/cover-provider';

@Injectable()
export class CoverProviderRegistry {
  constructor(
    @Inject(COVER_PROVIDERS)
    private readonly providers: CoverProvider[],
  ) {}

  all(): CoverProvider[] {
    return this.providers;
  }

  select(provider?: string): CoverProvider[] {
    const selected = provider?.trim();
    if (!selected) return [this.requireProvider('duckduckgo')];
    if (selected === 'all') return this.providers;
    if (selected === 'duckduckgo' || selected === 'itunes') {
      return [this.requireProvider(selected)];
    }
    throw new BadRequestException(`Unknown cover provider: ${selected}`);
  }

  private requireProvider(key: CoverProviderKey): CoverProvider {
    const found = this.providers.find((provider) => provider.key === key);
    if (!found) throw new BadRequestException(`Cover provider not registered: ${key}`);
    return found;
  }
}
