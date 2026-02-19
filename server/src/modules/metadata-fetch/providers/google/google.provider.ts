import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

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
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('externalApi.googleBooksApiKey') ?? '';
  }

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const query = this.buildQuery(params);
    if (!query) return [];
    return this.fetchVolumes(query);
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const url = this.buildUrl(`/volumes/${providerId}`);
    const res = await fetch(url);
    if (!res.ok) {
      this.logIfConfigError(res.status, `lookupById(${providerId})`);
      return null;
    }
    const item = (await res.json()) as GoogleVolumeItem;
    return mapGoogleVolume(item);
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    if (params.isbn) return `isbn:${params.isbn}`;
    if (params.title && params.author) return `intitle:${params.title}+inauthor:${params.author}`;
    if (params.title) return `intitle:${params.title}`;
    return null;
  }

  private async fetchVolumes(query: string): Promise<MetadataCandidate[]> {
    const url = this.buildUrl('/volumes', { q: query, maxResults: '10', printType: 'books' });
    const res = await fetch(url);
    if (!res.ok) {
      this.logIfConfigError(res.status, `search("${query}")`);
      return [];
    }
    const body = (await res.json()) as GoogleBooksResponse;
    return (body.items ?? []).map(mapGoogleVolume);
  }

  private buildUrl(path: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams(extra);
    if (this.apiKey) params.set('key', this.apiKey);
    const qs = params.toString();
    return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  }

  private logIfConfigError(status: number, context: string): void {
    if (status === 400 || status === 403) {
      this.logger.warn(`Google Books API config error (${status}) during ${context} - check GOOGLE_BOOKS_API_KEY`);
    }
  }
}
