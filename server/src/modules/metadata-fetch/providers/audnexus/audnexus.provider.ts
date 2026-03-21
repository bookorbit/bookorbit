import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { normalizeAudibleDomain } from '../audible/normalize-audible-domain';
import { MetadataProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapAudNexusBook } from './audnexus.mapper';
import { AudNexusBook, AudNexusChaptersResponse } from './audnexus.types';

const BASE_URL = 'https://api.audnex.us';
const AUDIBLE_RESPONSE_GROUPS = 'product_attrs';

interface AudibleSearchResponse {
  products?: Array<{
    asin?: string;
  }>;
}

@Injectable()
export class AudnexusProvider implements MetadataProvider {
  readonly key = MetadataProviderKey.AUDNEXUS;
  readonly label = 'AudNexus';
  readonly identifiable = false as const;

  private readonly logger = new Logger(AudnexusProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const config = await this.providerConfig.getConfig();
    if (!config.audnexus.enabled || !params.isAudiobook) return [];
    const audibleDomain = normalizeAudibleDomain(config.audible.domain);

    const audibleAsin = params.existingProviderIds?.[MetadataProviderKey.AUDIBLE] ?? (await this.resolveAsinViaAudible(params, audibleDomain));
    if (!audibleAsin) return [];

    try {
      const result = await this.fetchByAsin(audibleAsin);
      return result ? [result] : [];
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.error(`AudNexus search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async resolveAsinViaAudible(params: MetadataSearchParams, domain: string): Promise<string | null> {
    const query = [params.title, params.author]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim();
    if (!query) return null;

    const url = new URL(`https://api.audible.${domain}/1.0/catalog/products`);
    url.searchParams.set('num_results', '1');
    url.searchParams.set('keywords', query);
    url.searchParams.set('response_groups', AUDIBLE_RESPONSE_GROUPS);

    try {
      const res = await fetchWithThrottle(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`AudNexus Audible ASIN resolve returned ${res.status} for query "${query}"`);
        return null;
      }
      const body = (await res.json()) as AudibleSearchResponse;
      return body.products?.[0]?.asin?.trim() || null;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.error(`AudNexus Audible ASIN resolve failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async fetchByAsin(asin: string): Promise<MetadataCandidate | null> {
    try {
      const [bookRes, chaptersRes] = await Promise.all([
        fetchWithThrottle(`${BASE_URL}/books/${asin}`, { signal: AbortSignal.timeout(10_000) }),
        fetchWithThrottle(`${BASE_URL}/books/${asin}/chapters`, {
          signal: AbortSignal.timeout(10_000),
        }),
      ]);

      if (!bookRes.ok) {
        this.logger.warn(`AudNexus book API returned ${bookRes.status} for ASIN ${asin}`);
        return null;
      }

      const book = (await bookRes.json()) as AudNexusBook;
      const chapters = chaptersRes.ok ? ((await chaptersRes.json()) as AudNexusChaptersResponse) : undefined;

      return mapAudNexusBook(book, chapters);
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.error(`AudNexus ASIN fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
