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
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[audible] fetch.start op=search query="${query}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[audible] fetch.fail op=search query="${query}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return [];
      }
      const body = (await res.json()) as AudibleSearchResponse;
      const results = (body.products ?? []).map(mapAudibleProduct);
      this.logger.log(
        `[audible] fetch.end op=search query="${query}" status=${res.status} resultCount=${results.length} durationMs=${Date.now() - startedAt}`,
      );
      return results;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[audible] fetch.fail op=search query="${query}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[audible] fetch.fail op=search query="${query}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return [];
    }
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled, domain } = await this.providerConfig.getConfig().then((c) => c.audible);
    if (!enabled) return null;
    const normalizedDomain = normalizeAudibleDomain(domain);

    const url = new URL(`https://api.audible.${normalizedDomain}/1.0/catalog/products/${providerId}`);
    url.searchParams.set('response_groups', 'product_desc,media,product_attrs,series,product_plan_details,category_ladders');
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[audible] fetch.start op=lookup providerId="${providerId}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[audible] fetch.fail op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const body = (await res.json()) as { product: AudibleSearchResponse['products'][0] };
      const result = body.product ? mapAudibleProduct(body.product) : null;
      this.logger.log(
        `[audible] fetch.end op=lookup providerId="${providerId}" status=${res.status} found=${result != null} durationMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[audible] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[audible] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
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
