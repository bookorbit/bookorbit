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
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[audnexus] fetch.start op=resolve-asin method=GET query="${query}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[audnexus] fetch.fail op=resolve-asin method=GET query="${query}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const body = (await res.json()) as AudibleSearchResponse;
      const asin = body.products?.[0]?.asin?.trim() || null;
      this.logger.log(
        `[audnexus] fetch.end op=resolve-asin method=GET query="${query}" status=${res.status} found=${asin != null} durationMs=${Date.now() - startedAt}`,
      );
      return asin;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[audnexus] fetch.fail op=resolve-asin method=GET query="${query}" durationMs=${Date.now() - startedAt} message="throttled"`,
        );
        throw err;
      }
      this.logger.error(
        `[audnexus] fetch.fail op=resolve-asin method=GET query="${query}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return null;
    }
  }

  private async fetchByAsin(asin: string): Promise<MetadataCandidate | null> {
    const bookUrl = `${BASE_URL}/books/${asin}`;
    const chaptersUrl = `${BASE_URL}/books/${asin}/chapters`;
    const bookStartedAt = Date.now();
    const chaptersStartedAt = Date.now();
    this.logger.log(`[audnexus] fetch.start op=lookup-book method=GET providerId="${asin}"`);
    this.logger.log(`[audnexus] fetch.start op=lookup-chapters method=GET providerId="${asin}"`);

    try {
      const [bookRes, chaptersRes] = await Promise.all([
        fetchWithThrottle(bookUrl, { signal: AbortSignal.timeout(10_000) }),
        fetchWithThrottle(chaptersUrl, {
          signal: AbortSignal.timeout(10_000),
        }),
      ]);

      if (!bookRes.ok) {
        this.logger.warn(
          `[audnexus] fetch.fail op=lookup-book method=GET providerId="${asin}" status=${bookRes.status} durationMs=${Date.now() - bookStartedAt} message="non-ok response"`,
        );
        return null;
      }
      this.logger.log(
        `[audnexus] fetch.end op=lookup-book method=GET providerId="${asin}" status=${bookRes.status} durationMs=${Date.now() - bookStartedAt}`,
      );

      if (!chaptersRes.ok) {
        this.logger.warn(
          `[audnexus] fetch.fail op=lookup-chapters method=GET providerId="${asin}" status=${chaptersRes.status} durationMs=${Date.now() - chaptersStartedAt} message="non-ok response"`,
        );
      } else {
        this.logger.log(
          `[audnexus] fetch.end op=lookup-chapters method=GET providerId="${asin}" status=${chaptersRes.status} durationMs=${Date.now() - chaptersStartedAt}`,
        );
      }

      const book = (await bookRes.json()) as AudNexusBook;
      const chapters = chaptersRes.ok ? ((await chaptersRes.json()) as AudNexusChaptersResponse) : undefined;

      return mapAudNexusBook(book, chapters);
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[audnexus] fetch.fail op=lookup-asin method=GET providerId="${asin}" durationMs=${Date.now() - bookStartedAt} message="throttled"`,
        );
        throw err;
      }
      this.logger.error(
        `[audnexus] fetch.fail op=lookup-asin method=GET providerId="${asin}" durationMs=${Date.now() - bookStartedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return null;
    }
  }
}
