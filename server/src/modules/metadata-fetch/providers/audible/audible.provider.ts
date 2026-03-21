import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapAudibleProduct } from './audible.mapper';
import { AudibleSearchResponse } from './audible.types';
import { normalizeAudibleDomain } from './normalize-audible-domain';

@Injectable()
export class AudibleProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.AUDIBLE;
  readonly label = 'Audible';
  readonly identifiable = true as const;

  private readonly logger = new Logger(AudibleProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, domain } = await this.providerConfig.getConfig().then((c) => c.audible);
    if (!enabled || !params.isAudiobook) return [];
    const normalizedDomain = normalizeAudibleDomain(domain);

    const query = this.buildQuery(params);
    if (!query) return [];

    const url = new URL(`https://api.audible.${normalizedDomain}/1.0/catalog/products`);
    url.searchParams.set('num_results', '10');
    url.searchParams.set('keywords', query);
    url.searchParams.set('response_groups', 'product_desc,media,product_attrs,series,product_plan_details,category_ladders');

    try {
      const res = await fetchWithThrottle(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`Audible Search API returned ${res.status} for search("${query}")`);
        return [];
      }
      const body = (await res.json()) as AudibleSearchResponse;
      return (body.products ?? []).map(mapAudibleProduct);
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.error(`Audible search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled, domain } = await this.providerConfig.getConfig().then((c) => c.audible);
    if (!enabled) return null;
    const normalizedDomain = normalizeAudibleDomain(domain);

    const url = new URL(`https://api.audible.${normalizedDomain}/1.0/catalog/products/${providerId}`);
    url.searchParams.set('response_groups', 'product_desc,media,product_attrs,series,product_plan_details,category_ladders');

    try {
      const res = await fetchWithThrottle(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`Audible Lookup API returned ${res.status} for lookupById(${providerId})`);
        return null;
      }
      const body = (await res.json()) as { product: AudibleSearchResponse['products'][0] };
      return body.product ? mapAudibleProduct(body.product) : null;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.error(`Audible lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    const parts: string[] = [];
    if (params.title) parts.push(params.title);
    if (params.author) parts.push(params.author);
    return parts.length ? parts.join(' ') : null;
  }
}
