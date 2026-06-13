import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { PROVIDER_DELAYS_MS, PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { MetadataSearchParams } from '../metadata-search-params';
import { buildRequestSignal, normalizeMaxCandidates, sleep } from '../provider-utils';
import {
  buildLubimyczytacBookUrl,
  buildLubimyczytacSearchUrl,
  extractLubimyczytacPath,
  extractLubimyczytacSearchResults,
  LubimyczytacSearchResultLink,
  parseLubimyczytacBookPage,
} from './lubimyczytac.scraper';

const HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
};

type FetchContext = {
  op: 'search' | 'lookup';
  query?: string;
  providerId?: string;
};

@Injectable()
export class LubimyczytacProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.LUBIMYCZYTAC;
  readonly label = 'LubimyCzytac';
  readonly identifiable = true as const;
  readonly timeoutMs = PROVIDER_TIMEOUT_MS.SCRAPE;

  private readonly logger = new Logger(LubimyczytacProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.lubimyczytac);
    if (!enabled) return [];

    const maxCandidates = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.LUBIMYCZYTAC_MAX_RESULTS);
    const links = await this.searchBookLinks(params, maxCandidates, params.signal);

    const results: MetadataCandidate[] = [];
    for (const link of links.slice(0, maxCandidates)) {
      if (params.signal?.aborted) break;
      if (results.length > 0) {
        await sleep(PROVIDER_DELAYS_MS.LUBIMYCZYTAC_BETWEEN_REQUESTS, params.signal);
      }
      const candidate = await this.fetchByUrl(link.url, link.providerId, params.signal);
      if (candidate) results.push(candidate);
    }

    return results;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.lubimyczytac);
    if (!enabled) return null;
    const normalized = extractLubimyczytacPath(providerId);
    if (!normalized) return null;
    return this.fetchByUrl(buildLubimyczytacBookUrl(normalized), normalized, signal);
  }

  private async searchBookLinks(params: MetadataSearchParams, limit: number, signal?: AbortSignal): Promise<LubimyczytacSearchResultLink[]> {
    const query = params.title?.trim() || params.isbn?.trim();
    if (!query) return [];

    const url = buildLubimyczytacSearchUrl(query, params.author);
    const html = await this.fetchHtml(url, { op: 'search', query }, signal);
    return html ? extractLubimyczytacSearchResults(html, limit) : [];
  }

  private async fetchByUrl(url: string, fallbackProviderId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const html = await this.fetchHtml(url, { op: 'lookup', providerId: fallbackProviderId }, signal);
    if (!html) return null;

    const data = parseLubimyczytacBookPage(html, url);
    const providerId = data.providerId || extractLubimyczytacPath(url) || fallbackProviderId;
    if (!data.title || !providerId) return null;

    return {
      provider: MetadataProviderKey.LUBIMYCZYTAC,
      providerId,
      title: data.title,
      authors: data.authors?.length ? data.authors : undefined,
      description: data.description,
      publisher: data.publisher,
      publishedYear: data.publishedYear,
      language: data.language,
      pageCount: data.pageCount,
      isbn10: data.isbn10,
      isbn13: data.isbn13,
      seriesName: data.seriesName,
      seriesIndex: data.seriesIndex,
      genres: data.genres?.length ? data.genres : undefined,
      coverUrl: data.coverUrl,
      sourceUrl: url,
    };
  }

  private async fetchHtml(url: string, context: FetchContext, signal?: AbortSignal): Promise<string | null> {
    const startedAt = Date.now();
    const safeQuery = context.query ? sanitizeLogValue(context.query) : undefined;
    const safeProviderId = context.providerId ? sanitizeLogValue(context.providerId) : undefined;
    const subject = `${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''}`;
    this.logger.log(`[lubimyczytac] [start] op=${context.op}${subject} - lubimyczytac fetch started`);

    try {
      const res = await fetchWithThrottle(url, { headers: HEADERS, signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.SCRAPE, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[lubimyczytac] [fail] op=${context.op}${subject} status=${res.status} durationMs=${Date.now() - startedAt} errorClass=HttpError error="non-ok response" - lubimyczytac fetch failed`,
        );
        return null;
      }
      const html = await res.text();
      this.logger.log(
        `[lubimyczytac] [end] op=${context.op}${subject} status=${res.status} durationMs=${Date.now() - startedAt} bytes=${html.length} - lubimyczytac fetch completed`,
      );
      return html;
    } catch (error) {
      if (error instanceof ProviderThrottleError) {
        this.logger.warn(
          `[lubimyczytac] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=ProviderThrottleError error="throttled" - lubimyczytac fetch throttled`,
        );
        throw error;
      }
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[lubimyczytac] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - lubimyczytac fetch failed`,
      );
      return null;
    }
  }
}
