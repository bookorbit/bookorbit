import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { appConfig } from '../../../../config/config';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { PROVIDER_DELAYS_MS, PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { MetadataSearchParams } from '../metadata-search-params';
import { normalizeMaxCandidates, sleep } from '../provider-utils';
import { fetchKoboHtmlWithCloudscraper } from './kobo-cloudscraper.fetcher';
import {
  buildKoboBookUrl,
  buildKoboSearchUrl,
  extractKoboProviderId,
  extractKoboSearchResults,
  isKoboChallengePage,
  isKoboProductUrl,
  KoboRegionConfig,
  normalizeKoboProviderId,
  parseKoboBookPage,
} from './kobo.scraper';

type FetchOperation = 'search' | 'lookup';
type FetchContext = {
  op: FetchOperation;
  query?: string;
  providerId?: string;
};
type FetchedHtml = {
  html: string;
  url: string;
  attempts: number;
};

const KOBO_FETCH_TIMEOUT_MS = 5_000;
const KOBO_SEARCH_FETCH_ATTEMPTS = 3;
const KOBO_LOOKUP_FETCH_ATTEMPTS = 2;
const KOBO_FETCH_RETRY_DELAY_MS = 250;

@Injectable()
export class KoboProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.KOBO;
  readonly label = 'Kobo';
  readonly identifiable = true as const;
  readonly timeoutMs = PROVIDER_TIMEOUT_MS.KOBO_SCRAPE;

  private readonly logger = new Logger(KoboProvider.name);

  constructor(
    private readonly providerConfig: ProviderConfigService,
    @Inject(appConfig.KEY) private readonly appConfiguration: ConfigType<typeof appConfig>,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const config = await this.providerConfig.getConfig().then((c) => c.kobo);
    if (!config.enabled) return [];

    const maxCandidates = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.KOBO_MAX_RESULTS);
    const links = await this.searchBookLinks(params, config, maxCandidates, params.signal);
    const results: MetadataCandidate[] = [];

    for (const link of links.slice(0, maxCandidates)) {
      if (params.signal?.aborted) break;
      if (results.length > 0) {
        await sleep(PROVIDER_DELAYS_MS.KOBO_BETWEEN_REQUESTS, params.signal);
      }
      const candidate = await this.fetchByUrl(link.url, link.providerId, params.signal);
      if (candidate) results.push(candidate);
      if (params.signal?.aborted) break;
    }

    return results;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const config = await this.providerConfig.getConfig().then((c) => c.kobo);
    if (!config.enabled) return null;
    const normalizedProviderId = normalizeKoboProviderId(providerId);
    if (!normalizedProviderId) return null;
    return this.fetchByUrl(buildKoboBookUrl(normalizedProviderId, config), normalizedProviderId, signal);
  }

  private async searchBookLinks(
    params: MetadataSearchParams,
    config: KoboRegionConfig,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Array<{ providerId: string; url: string }>> {
    const query = params.isbn?.trim() || [params.title, params.author].filter(Boolean).join(' ');
    if (!query) return [];

    const url = buildKoboSearchUrl(query, 1, config);
    const fetched = await this.fetchHtml(url, { op: 'search', query }, signal);
    if (!fetched) return [];

    if (isKoboProductUrl(fetched.url)) {
      const providerId = extractKoboProviderId(fetched.url);
      return providerId ? [{ providerId, url: fetched.url }] : [];
    }

    return extractKoboSearchResults(fetched.html, limit);
  }

  private async fetchByUrl(url: string, fallbackProviderId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const fetched = await this.fetchHtml(url, { op: 'lookup', providerId: fallbackProviderId }, signal);
    if (!fetched) return null;

    const data = parseKoboBookPage(fetched.html, fetched.url);
    const providerId = data.providerId || extractKoboProviderId(fetched.url) || fallbackProviderId;
    if (!data.title || !providerId) return null;

    return {
      provider: MetadataProviderKey.KOBO,
      providerId,
      title: data.title,
      subtitle: data.subtitle,
      authors: data.authors?.length ? data.authors : undefined,
      description: data.description,
      publisher: data.publisher,
      publishedDate: data.publishedDate,
      publishedYear: data.publishedYear,
      language: data.language,
      pageCount: data.pageCount,
      isbn10: data.isbn10,
      isbn13: data.isbn13,
      seriesName: data.seriesName,
      seriesIndex: data.seriesIndex,
      genres: data.genres?.length ? data.genres : undefined,
      coverUrl: data.coverUrl,
      sourceUrl: fetched.url,
    };
  }

  private async fetchHtml(url: string, context: FetchContext, signal?: AbortSignal): Promise<FetchedHtml | null> {
    const startedAt = Date.now();
    const safeQuery = context.query ? sanitizeLogValue(context.query) : undefined;
    const safeProviderId = context.providerId ? sanitizeLogValue(context.providerId) : undefined;
    const subject = `${safeQuery ? ` query="${safeQuery}"` : ''}${safeProviderId ? ` providerId="${safeProviderId}"` : ''}`;
    this.logger.log(`[kobo] [start] op=${context.op}${subject} - kobo fetch started`);

    try {
      const maxAttempts = context.op === 'search' ? KOBO_SEARCH_FETCH_ATTEMPTS : KOBO_LOOKUP_FETCH_ATTEMPTS;
      const fetched = await this.fetchWithCloudscraperRetry(url, maxAttempts, signal);

      if (fetched.status === 429) {
        throw new ProviderThrottleError(parseRetryAfterSeconds(fetched.headers['retry-after']));
      }

      if (isKoboChallengePage(fetched.html, toChallengeResponse(fetched))) {
        this.logger.warn(
          `[kobo] [fail] op=${context.op}${subject} status=${fetched.status} durationMs=${Date.now() - startedAt} attempts=${fetched.attempts} errorClass=KoboChallenge error="cloudflare challenge" - kobo fetch blocked`,
        );
        return null;
      }

      if (fetched.status < 200 || fetched.status >= 300) {
        this.logger.warn(
          `[kobo] [fail] op=${context.op}${subject} status=${fetched.status} durationMs=${Date.now() - startedAt} attempts=${fetched.attempts} errorClass=HttpError error="non-ok response" - kobo fetch failed`,
        );
        return null;
      }

      this.logger.log(
        `[kobo] [end] op=${context.op}${subject} status=${fetched.status} durationMs=${Date.now() - startedAt} attempts=${fetched.attempts} bytes=${fetched.html.length} - kobo fetch completed`,
      );
      return { html: fetched.html, url: fetched.url || url, attempts: fetched.attempts };
    } catch (error) {
      if (error instanceof ProviderThrottleError) {
        this.logger.warn(
          `[kobo] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=ProviderThrottleError error="throttled" - kobo fetch throttled`,
        );
        throw error;
      }

      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[kobo] [fail] op=${context.op}${subject} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - kobo fetch failed`,
      );
      return null;
    }
  }

  private async fetchWithCloudscraperRetry(
    url: string,
    maxAttempts: number,
    signal?: AbortSignal,
  ): Promise<FetchedHtml & { status: number; headers: Record<string, string> }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      try {
        const fetched = await fetchKoboHtmlWithCloudscraper(url, {
          maxAttempts: 1,
          pythonPath: this.appConfiguration.koboCloudscraperPython,
          signal,
          timeoutMs: KOBO_FETCH_TIMEOUT_MS,
        });
        return { ...fetched, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (signal?.aborted || isAbortError(error) || attempt >= maxAttempts) {
          throw error;
        }
        await sleep(KOBO_FETCH_RETRY_DELAY_MS, signal);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('cloudscraper failed');
  }
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toChallengeResponse(fetched: { status: number; headers: Record<string, string> }) {
  return {
    status: fetched.status,
    headers: {
      get: (name: string) => fetched.headers[name.toLowerCase()] ?? null,
    },
  };
}

function parseRetryAfterSeconds(retryAfter: string | undefined): number | undefined {
  if (!retryAfter) return undefined;
  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);

  const retryAtEpochMs = Date.parse(retryAfter);
  if (Number.isNaN(retryAtEpochMs)) return undefined;
  const remainingSeconds = Math.ceil((retryAtEpochMs - Date.now()) / 1000);
  return remainingSeconds > 0 ? remainingSeconds : undefined;
}
