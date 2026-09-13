import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey, parseSeriesIndex } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { amazonRequestHeaders, isAmazonBotChallenge } from '../../../../common/utils/amazon-http.utils';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { amazonOrigin } from '../../../../common/utils/metadata-provider-hosts.utils';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { PROVIDER_DELAYS_MS, PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { MetadataSearchParams } from '../metadata-search-params';
import { buildRequestSignal, normalizeMaxCandidates, rethrowWithPartialCandidates, sleep } from '../provider-utils';
import { extractAsins, parseBookPage } from './amazon.scraper';

@Injectable()
export class AmazonProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.AMAZON;
  readonly label = 'Amazon';
  readonly identifiable = true as const;

  private readonly logger = new Logger(AmazonProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, domain, cookie } = await this.providerConfig.getConfig().then((c) => c.amazon);
    if (!enabled) return [];

    const maxCandidates = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.AMAZON_MAX_RESULTS);
    const asins = await this.searchAsins(params, domain, cookie, maxCandidates, params.signal);

    const results: MetadataCandidate[] = [];
    try {
      for (const asin of asins.slice(0, maxCandidates)) {
        if (results.length > 0) {
          await sleep(PROVIDER_DELAYS_MS.AMAZON_BETWEEN_REQUESTS, params.signal);
        }
        const candidate = await this.fetchByAsin(asin, domain, cookie, params.signal);
        if (candidate) results.push(candidate);
      }
    } catch (err) {
      rethrowWithPartialCandidates(err, results);
    }
    return results;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, domain, cookie } = await this.providerConfig.getConfig().then((c) => c.amazon);
    if (!enabled) return null;
    return this.fetchByAsin(providerId, domain, cookie, signal);
  }

  private async searchAsins(params: MetadataSearchParams, domain: string, cookie: string, limit: number, signal?: AbortSignal): Promise<string[]> {
    const query = params.isbn?.trim() || [params.title, params.author].filter(Boolean).join(' ');
    if (!query) return [];
    const url = `${amazonOrigin(domain)}/gp/aw/s?k=${encodeURIComponent(query)}&i=stripbooks`;
    const html = await this.fetchHtml(url, cookie, 'search', query, undefined, signal);
    return html ? extractAsins(html, limit) : [];
  }

  private async fetchByAsin(asin: string, domain: string, cookie: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const url = new URL(`/dp/${encodeURIComponent(asin)}`, amazonOrigin(domain));
    const html = await this.fetchHtml(url.toString(), cookie, 'lookup', undefined, asin, signal);
    if (!html) return null;
    const data = parseBookPage(html);
    if (!data.title) return null;
    return {
      provider: MetadataProviderKey.AMAZON,
      providerId: asin,
      title: data.title,
      subtitle: data.subtitle,
      authors: data.authors?.length ? data.authors : undefined,
      description: data.description,
      isbn13: data.isbn13,
      isbn10: data.isbn10,
      publisher: data.publisher,
      publishedDate: data.publishedDate,
      publishedYear: data.publishedYear,
      language: data.language,
      pageCount: data.pageCount,
      seriesName: data.seriesName,
      seriesIndex: parseSeriesIndex(data.seriesIndex) ?? undefined,
      seriesTotalBooks: data.seriesTotalBooks,
      coverUrl: data.coverUrl,
      genres: data.tags?.length ? data.tags : undefined,
      sourceUrl: url.toString(),
      ...(data.communityRating !== undefined ? { communityRating: data.communityRating } : {}),
      ...(data.communityRatingCount !== undefined ? { communityRatingCount: data.communityRatingCount } : {}),
    };
  }

  private async fetchHtml(
    url: string,
    cookie = '',
    op: 'search' | 'lookup' = 'search',
    query?: string,
    providerId?: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const headers = amazonRequestHeaders(url, cookie);
    const startedAt = Date.now();
    const safeQuery = query ? sanitizeLogValue(query) : undefined;
    const safeProviderId = providerId ? sanitizeLogValue(providerId) : undefined;
    this.logger.log(`[amazon] [start] op=${op}${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''}`);
    try {
      const res = await fetchWithThrottle(url, { headers, signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.SCRAPE, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[amazon] [fail] op=${op}${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const html = await res.text();
      if (isAmazonBotChallenge(html)) {
        throw new ProviderThrottleError(undefined, 'bot challenge');
      }
      this.logger.log(
        `[amazon] [end] op=${op}${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt}`,
      );
      return html;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[amazon] [fail] op=${op}${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''} durationMs=${Date.now() - startedAt} message="throttled"`,
        );
        throw err;
      }
      this.logger.warn(
        `[amazon] [fail] op=${op}${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''} durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return null;
    }
  }
}
