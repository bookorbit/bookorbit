import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { markProviderDegraded, markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { pickSearchInputs, providerCacheContext, widenedPageSize } from '../provider-cache';
import { PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal, searchPageSize } from '../provider-utils';
import { GoogleCoverValidator } from './google-cover-validator';
import { mapGoogleVolume } from './google.mapper';
import { GoogleBooksResponse, GoogleVolumeItem } from './google.types';

const BASE_URL = 'https://www.googleapis.com/books/v1';
const SEARCH_PAGE_SIZE = 10;

interface GoogleErrorBody {
  error?: unknown;
}

@Injectable()
export class GoogleProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.GOOGLE;
  readonly label = 'Google Books';
  readonly identifiable = true as const;
  readonly coverShape = 'portrait' as const;

  private readonly logger = new Logger(GoogleProvider.name);
  private readonly coverValidator = new GoogleCoverValidator();

  readonly cache: ProviderCacheSpec<MetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    // The volumes endpoint answers an unknown id with 404.
    authoritativeLookupStatuses: [404],
    context: async () => {
      const { enabled, apiKey } = (await this.providerConfig.getConfig()).google;
      return providerCacheContext(enabled && apiKey.trim().length > 0);
    },
    // The query is the ISBN alone whenever one is given; title and author only matter without it.
    describeSearch: (params) => ({
      inputs: {
        ...(params.isbn ? { isbn: params.isbn } : pickSearchInputs(params, ['title', 'author'])),
        pageSize: widenedPageSize(params, SEARCH_PAGE_SIZE),
      },
      coverValidation: params.validateCoverPlaceholders ?? false,
    }),
    describeLookup: (providerId) => ({ inputs: { id: providerId } }),
  };

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.google);
    if (!enabled || !apiKey.trim()) return [];
    const query = this.buildQuery(params);
    if (!query) return [];
    return this.fetchVolumes(query, apiKey, searchPageSize(params, SEARCH_PAGE_SIZE), params.validateCoverPlaceholders ?? false, params.signal);
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.google);
    if (!enabled || !apiKey.trim()) return null;
    const url = this.buildUrl(`/volumes/${providerId}`, {}, apiKey);
    const startedAt = Date.now();
    this.logger.log(`[google] [start] op=lookup providerId="${providerId}"`);

    try {
      const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[google] [fail] op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const item = (await res.json()) as GoogleVolumeItem & GoogleErrorBody;
      if (item.error !== undefined || typeof item.id !== 'string') markProviderFailed('google.lookup: api error body');
      const mapped = mapGoogleVolume(item);
      this.logger.log(
        `[google] [end] op=lookup providerId="${providerId}" status=${res.status} found=${mapped != null} durationMs=${Date.now() - startedAt}`,
      );
      return mapped;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[google] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      markProviderFailed('google.lookup: unusable response');
      this.logger.warn(
        `[google] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      throw err;
    }
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    const parts: string[] = [];
    if (params.isbn) return `isbn:${params.isbn}`;
    if (params.title) parts.push(`intitle:${params.title}`);
    if (params.author) parts.push(`inauthor:${params.author}`);
    return parts.length ? parts.join(' ') : null;
  }

  private async fetchVolumes(
    query: string,
    apiKey: string,
    pageSize: number,
    validateCoverPlaceholders: boolean,
    signal?: AbortSignal,
  ): Promise<MetadataCandidate[]> {
    const url = this.buildUrl('/volumes', { q: query, maxResults: String(pageSize), printType: 'books' }, apiKey);
    const startedAt = Date.now();
    const safeQuery = sanitizeLogValue(query);
    this.logger.log(`[google] [start] op=search query="${safeQuery}"`);

    try {
      const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[google] [fail] op=search query="${safeQuery}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return [];
      }
      const body = (await res.json()) as GoogleBooksResponse & GoogleErrorBody;
      this.reportSearchBodyQuality(body);
      const mappedItems = (body.items ?? []).map(mapGoogleVolume);
      const items = validateCoverPlaceholders ? await this.coverValidator.filterCandidates(mappedItems, signal) : mappedItems;
      this.logger.log(
        `[google] [end] op=search query="${safeQuery}" status=${res.status} resultCount=${items.length} durationMs=${Date.now() - startedAt}`,
      );
      return items;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[google] [fail] op=search query="${safeQuery}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      markProviderFailed('google.search: unusable response');
      this.logger.warn(
        `[google] [fail] op=search query="${safeQuery}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      throw err;
    }
  }

  private reportSearchBodyQuality(body: GoogleBooksResponse & GoogleErrorBody): void {
    if (body.error !== undefined || (body.items !== undefined && !Array.isArray(body.items))) {
      markProviderFailed('google.search: api error body');
      return;
    }
    // A real "no results" answer says `totalItems: 0`; a body without it is not evidence of none.
    if (body.items === undefined && typeof body.totalItems !== 'number') {
      markProviderFailed('google.search: response without totalItems');
      return;
    }
    if ((body.totalItems ?? 0) > 0 && !body.items?.length) markProviderDegraded('google.search: total without items');
  }

  private buildUrl(path: string, extra: Record<string, string> = {}, apiKey = ''): string {
    const params = new URLSearchParams(extra);
    if (apiKey) params.set('key', apiKey);
    const qs = params.toString();
    return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  }
}
