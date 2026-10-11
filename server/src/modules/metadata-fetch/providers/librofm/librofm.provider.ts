import { Injectable, Logger } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

import { markProviderDegraded, markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import type { IdentifiableProvider } from '../metadata-provider';
import type { MetadataSearchParams } from '../metadata-search-params';
import { audiobookGate, pickSearchInputs, providerCacheContext, requestedMax } from '../provider-cache';
import { PROVIDER_DELAYS_MS, PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { allowsAudiobookProviders, buildRequestSignal, normalizeMaxCandidates, rethrowWithPartialCandidates, sleep } from '../provider-utils';
import { mapLibroFmAudiobook } from './librofm.mapper';
import type { LibroFmDetailsResponse, LibroFmSearchResponse } from './librofm.types';

const API_BASE_URL = 'https://libro.fm/api/v12/explore';
const REQUEST_HEADERS: HeadersInit = {
  accept: 'application/json',
  'user-agent': 'okhttp/4.12.0',
  'x-librofm-appver': '7.37.4',
};

function directLookupId(params: MetadataSearchParams): string | undefined {
  return params.existingProviderIds?.[MetadataProviderKey.LIBROFM] ?? params.isbn?.trim();
}

@Injectable()
export class LibroFmProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.LIBROFM;
  readonly label = 'Libro.fm';
  readonly identifiable = true as const;
  readonly coverShape = 'square' as const;
  readonly mediaKinds = ['audiobook'] as const;

  private readonly logger = new Logger(LibroFmProvider.name);

  readonly cache: ProviderCacheSpec<MetadataSearchParams> = {
    version: 1,
    trustEmpty: false,
    context: async () => providerCacheContext((await this.providerConfig.getConfig()).librofm.enabled),
    describeSearch: (params) => {
      const audiobook = audiobookGate(params);
      const directId = directLookupId(params);
      // A direct id answers with at most one book, so no result cap applies to it.
      if (directId) return { inputs: { directId, audiobook } };
      return { inputs: { ...pickSearchInputs(params, ['title', 'author']), audiobook }, maxCandidates: requestedMax(params) };
    },
    describeLookup: (providerId) => ({ inputs: { id: providerId } }),
  };

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((config) => config.librofm);
    if (!enabled || !allowsAudiobookProviders(params)) return [];

    const directId = directLookupId(params);
    if (directId) {
      const candidate = await this.fetchByIsbn(directId, params.signal);
      return candidate ? [candidate] : [];
    }

    const query = [params.title, params.author]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim();
    if (!query) return [];

    const maxCandidates = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.LIBROFM_MAX_RESULTS);
    const isbns = await this.searchIsbns(query, maxCandidates, params.signal);
    const candidates: MetadataCandidate[] = [];
    try {
      for (const isbn of isbns) {
        if (candidates.length > 0) await sleep(PROVIDER_DELAYS_MS.LIBROFM_BETWEEN_REQUESTS, params.signal);
        const candidate = await this.fetchByIsbn(isbn, params.signal);
        if (candidate) candidates.push(candidate);
        else markProviderDegraded('librofm.search: audiobook skipped');
      }
    } catch (err) {
      rethrowWithPartialCandidates(err, candidates);
    }
    return candidates;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((config) => config.librofm);
    if (!enabled) return null;
    return this.fetchByIsbn(providerId, signal);
  }

  private async searchIsbns(query: string, limit: number, signal?: AbortSignal): Promise<string[]> {
    const url = new URL(`${API_BASE_URL}/search`);
    url.searchParams.set('page', '1');
    url.searchParams.set('q', query);
    url.searchParams.set('searchby', 'all');
    const startedAt = Date.now();
    const safeQuery = sanitizeLogValue(query);
    this.logger.log(`[librofm.metadata] [start] operation=search query="${safeQuery}" limit=${limit} - Libro.fm search started`);

    try {
      const response = await fetchWithThrottle(url, {
        headers: REQUEST_HEADERS,
        signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal),
      });
      if (!response.ok) {
        const errorMessage = sanitizeLogValue(`status ${response.status}`);
        this.logger.warn(
          `[librofm.metadata] [fail] operation=search query="${safeQuery}" durationMs=${Date.now() - startedAt} errorClass=HttpError error="${errorMessage}" - Libro.fm search failed`,
        );
        return [];
      }

      const body = (await response.json()) as LibroFmSearchResponse;
      const isbns = (body.audiobook_collection?.audiobooks ?? [])
        .map((book) => String(book.isbn ?? '').trim())
        .filter((isbn, index, values) => isbn.length > 0 && values.indexOf(isbn) === index)
        .slice(0, limit);
      this.logger.log(
        `[librofm.metadata] [end] operation=search query="${safeQuery}" durationMs=${Date.now() - startedAt} resultCount=${isbns.length} - Libro.fm search completed`,
      );
      return isbns;
    } catch (error) {
      if (error instanceof ProviderThrottleError) throw error;
      markProviderFailed('librofm.search: unusable response');
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[librofm.metadata] [fail] operation=search query="${safeQuery}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - Libro.fm search failed`,
      );
      return [];
    }
  }

  private async fetchByIsbn(isbn: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const providerId = isbn.trim();
    if (!providerId) return null;
    const safeProviderId = sanitizeLogValue(providerId);
    const startedAt = Date.now();
    this.logger.log(`[librofm.metadata] [start] operation=lookup providerId="${safeProviderId}" - Libro.fm lookup started`);

    try {
      const response = await fetchWithThrottle(`${API_BASE_URL}/audiobook_details/${encodeURIComponent(providerId)}`, {
        headers: REQUEST_HEADERS,
        signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal),
      });
      if (!response.ok) {
        const errorMessage = sanitizeLogValue(`status ${response.status}`);
        this.logger.warn(
          `[librofm.metadata] [fail] operation=lookup providerId="${safeProviderId}" durationMs=${Date.now() - startedAt} errorClass=HttpError error="${errorMessage}" - Libro.fm lookup failed`,
        );
        return null;
      }

      const body = (await response.json()) as LibroFmDetailsResponse;
      const book = body.data?.audiobook;
      if (!book) {
        this.logger.log(
          `[librofm.metadata] [end] operation=lookup providerId="${safeProviderId}" durationMs=${Date.now() - startedAt} found=false - Libro.fm lookup completed`,
        );
        return null;
      }
      const candidate = mapLibroFmAudiobook(book);
      this.logger.log(
        `[librofm.metadata] [end] operation=lookup providerId="${safeProviderId}" durationMs=${Date.now() - startedAt} found=true - Libro.fm lookup completed`,
      );
      return candidate;
    } catch (error) {
      if (error instanceof ProviderThrottleError) throw error;
      markProviderFailed('librofm.lookup: unusable response');
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[librofm.metadata] [fail] operation=lookup providerId="${safeProviderId}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - Libro.fm lookup failed`,
      );
      return null;
    }
  }
}
