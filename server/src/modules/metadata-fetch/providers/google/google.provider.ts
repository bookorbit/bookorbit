import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapGoogleVolume } from './google.mapper';
import { GoogleBooksResponse, GoogleVolumeItem } from './google.types';

const BASE_URL = 'https://www.googleapis.com/books/v1';

@Injectable()
export class GoogleProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.GOOGLE;
  readonly label = 'Google Books';
  readonly identifiable = true as const;

  private readonly logger = new Logger(GoogleProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.google);
    if (!enabled) return [];
    const query = this.buildQuery(params);
    if (!query) return [];
    return this.fetchVolumes(query, apiKey);
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.google);
    if (!enabled) return null;
    const url = this.buildUrl(`/volumes/${providerId}`, {}, apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      this.logger.warn(`Google Books API returned ${res.status} for lookupById(${providerId})`);
      return null;
    }
    const item = (await res.json()) as GoogleVolumeItem;
    return mapGoogleVolume(item);
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    const parts: string[] = [];
    if (params.isbn) return `isbn:${params.isbn}`;
    if (params.title) parts.push(`intitle:${params.title}`);
    if (params.author) parts.push(`inauthor:${params.author}`);
    return parts.length ? parts.join(' ') : null;
  }

  private async fetchVolumes(query: string, apiKey: string): Promise<MetadataCandidate[]> {
    const url = this.buildUrl('/volumes', { q: query, maxResults: '10', printType: 'books' }, apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      this.logger.warn(`Google Books API returned ${res.status} for search("${query}")`);
      return [];
    }
    const body = (await res.json()) as GoogleBooksResponse;
    return (body.items ?? []).map(mapGoogleVolume);
  }

  private buildUrl(path: string, extra: Record<string, string> = {}, apiKey = ''): string {
    const params = new URLSearchParams(extra);
    if (apiKey) params.set('key', apiKey);
    const qs = params.toString();
    return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  }
}
