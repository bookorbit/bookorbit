import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { extractAsins, parseBookPage } from './amazon.scraper';

const HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
};

const MAX_RESULTS = 3;
const BETWEEN_REQUESTS_MS = 800;

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

    const asins = await this.searchAsins(params, domain, cookie);

    const results: MetadataCandidate[] = [];
    for (const asin of asins.slice(0, MAX_RESULTS)) {
      if (results.length > 0) await sleep(BETWEEN_REQUESTS_MS);
      const candidate = await this.fetchByAsin(asin, domain, cookie);
      if (candidate) results.push(candidate);
    }
    return results;
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled, domain, cookie } = await this.providerConfig.getConfig().then((c) => c.amazon);
    if (!enabled) return null;
    return this.fetchByAsin(providerId, domain, cookie);
  }

  private async searchAsins(params: MetadataSearchParams, domain: string, cookie: string): Promise<string[]> {
    const query = params.isbn?.trim() || [params.title, params.author].filter(Boolean).join(' ');
    if (!query) return [];
    const url = `https://www.${domain}/s?k=${encodeURIComponent(query)}&i=stripbooks`;
    const html = await this.fetchHtml(url, cookie, 'search', query);
    return html ? extractAsins(html, MAX_RESULTS) : [];
  }

  private async fetchByAsin(asin: string, domain: string, cookie: string): Promise<MetadataCandidate | null> {
    const url = `https://www.${domain}/dp/${asin}`;
    const html = await this.fetchHtml(url, cookie, 'lookup', undefined, asin);
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
      publishedYear: data.publishedYear,
      language: data.language,
      pageCount: data.pageCount,
      seriesName: data.seriesName,
      seriesIndex: data.seriesIndex,
      coverUrl: data.coverUrl,
      genres: data.tags?.length ? data.tags : undefined,
      sourceUrl: `https://www.${domain}/dp/${asin}`,
    };
  }

  private async fetchHtml(url: string, cookie = '', op: 'search' | 'lookup' = 'search', query?: string, providerId?: string): Promise<string | null> {
    const headers: HeadersInit = cookie ? { ...HEADERS, cookie } : HEADERS;
    const startedAt = Date.now();
    this.logger.log(`[amazon] fetch.start op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''}`);
    try {
      const res = await fetchWithThrottle(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        this.logger.warn(
          `[amazon] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const html = await res.text();
      this.logger.log(
        `[amazon] fetch.end op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt}`,
      );
      return html;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[amazon] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} durationMs=${Date.now() - startedAt} message="throttled"`,
        );
        throw err;
      }
      this.logger.warn(
        `[amazon] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
