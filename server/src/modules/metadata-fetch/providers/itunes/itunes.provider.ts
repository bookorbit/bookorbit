import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapITunesResult } from './itunes.mapper';
import { ITunesResponse } from './itunes.types';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

@Injectable()
export class ITunesProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.ITUNES;
  readonly label = 'iTunes';
  readonly identifiable = true as const;

  private readonly logger = new Logger(ITunesProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return [];

    const query = this.buildQuery(params);
    if (!query) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('term', query);
    url.searchParams.set('entity', 'ebook'); // Default to ebook
    url.searchParams.set('limit', '10');

    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`iTunes Search API returned ${res.status} for search("${query}")`);
        return [];
      }
      const body = (await res.json()) as ITunesResponse;
      return body.results.map(mapITunesResult);
    } catch (err) {
      this.logger.error(`iTunes search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return null;

    const url = new URL(LOOKUP_URL);
    url.searchParams.set('id', providerId);

    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`iTunes Lookup API returned ${res.status} for lookupById(${providerId})`);
        return null;
      }
      const body = (await res.json()) as ITunesResponse;
      return body.results.length > 0 ? mapITunesResult(body.results[0]) : null;
    } catch (err) {
      this.logger.error(`iTunes lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    if (params.isbn) return params.isbn;
    const parts: string[] = [];
    if (params.title) parts.push(params.title);
    if (params.author) parts.push(params.author);
    return parts.length ? parts.join(' ') : null;
  }
}
