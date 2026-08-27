import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey, MetadataProviderSearchOutcome, MetadataProviderSearchStatus } from '@bookorbit/types';
import { filter, from, map, merge, Observable, switchMap } from 'rxjs';

import type { RequestUser } from '../../common/types/request-user';
import { filterAndRank } from './candidate-relevance';
import { MetadataFetchRepository, StoredProviderIdsRow } from './metadata-fetch.repository';
import { ProviderThrottleError } from './provider-throttle.error';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { ProviderRegistry } from './provider-registry';
import { PROVIDER_TIMEOUT_MS as PROVIDER_TIMEOUTS } from './providers/provider-constants';
import { isIdentifiable, MetadataProvider } from './providers/metadata-provider';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { sanitizeLogError } from './providers/provider-utils';

interface TimedProviderResult {
  results: MetadataCandidate[];
  timedOut: boolean;
}

interface ProviderSearchResult {
  candidates: MetadataCandidate[];
  /** Null when the provider ran to completion, whether or not it found anything. */
  outcome: MetadataProviderSearchOutcome | null;
}

/**
 * A search reports two different things: the records it found, and whether a provider was cut off
 * before it could finish. Without the second, an interrupted search is indistinguishable from a
 * genuinely empty one.
 */
export type MetadataSearchEvent = { kind: 'candidate'; candidate: MetadataCandidate } | { kind: 'status'; status: MetadataProviderSearchStatus };

export interface StoredProviderContext {
  libraryId: number;
  title: string | null;
  seriesName: string | null;
  seriesIndex: string | null;
  providerIds: Partial<Record<MetadataProviderKey, string>>;
}

@Injectable()
export class MetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = PROVIDER_TIMEOUTS.SCRAPE;
  private readonly logger = new Logger(MetadataFetchService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly metadataFetchRepository: MetadataFetchRepository,
  ) {}

  search(params: MetadataSearchParams, keys?: MetadataProviderKey[]): Observable<MetadataSearchEvent> {
    const providers = this.registry.select(keys);
    return merge(
      ...providers.map((provider) =>
        from(this.fetchFromProviderWithThrottleHandling(provider, params)).pipe(switchMap((result) => from(toSearchEvents(provider.key, result)))),
      ),
    );
  }

  /** Candidate-only view of `search`, for callers that have no use for provider status. */
  searchCandidates(params: MetadataSearchParams, keys?: MetadataProviderKey[]): Observable<MetadataCandidate> {
    return this.search(params, keys).pipe(
      filter((event): event is Extract<MetadataSearchEvent, { kind: 'candidate' }> => event.kind === 'candidate'),
      map((event) => event.candidate),
    );
  }

  async lookupById(key: MetadataProviderKey, providerId: string): Promise<MetadataCandidate | null> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiable(provider)) return null;
    return provider.lookupById(providerId);
  }

  async getStoredProviderIds(bookId: number, user: RequestUser): Promise<Partial<Record<MetadataProviderKey, string>>> {
    const context = await this.getStoredProviderContext(bookId, user);
    return context.providerIds;
  }

  async getStoredProviderContext(bookId: number, user: RequestUser): Promise<StoredProviderContext> {
    const row = await this.getAccessibleStoredProviderIdsRow(bookId, user);
    return {
      libraryId: row.libraryId,
      title: row.title,
      seriesName: row.seriesName,
      seriesIndex: row.seriesIndex,
      providerIds: this.mapStoredProviderIds(row),
    };
  }

  async getAccessibleBookLibraryId(bookId: number, user: RequestUser): Promise<number> {
    const row = await this.getAccessibleStoredProviderIdsRow(bookId, user);
    return row.libraryId;
  }

  private async getAccessibleStoredProviderIdsRow(bookId: number, user: RequestUser): Promise<StoredProviderIdsRow> {
    const row = await this.metadataFetchRepository.findStoredProviderIdsRow(bookId);
    if (!row) {
      throw new NotFoundException(`Book ${bookId} not found`);
    }

    if (!user.isSuperuser) {
      const hasAccess = await this.metadataFetchRepository.hasLibraryAccess(user.id, row.libraryId);
      if (!hasAccess) {
        throw new ForbiddenException(`No access to book ${bookId}`);
      }
    }

    return row;
  }

  private mapStoredProviderIds(row: StoredProviderIdsRow): Partial<Record<MetadataProviderKey, string>> {
    return {
      [MetadataProviderKey.GOOGLE]: row.googleBooksId ?? undefined,
      [MetadataProviderKey.GOODREADS]: row.goodreadsId ?? undefined,
      [MetadataProviderKey.AMAZON]: row.amazonId ?? undefined,
      [MetadataProviderKey.HARDCOVER]: row.hardcoverId ?? undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: row.openLibraryId ?? undefined,
      [MetadataProviderKey.ITUNES]: row.itunesId ?? undefined,
      [MetadataProviderKey.AUDIBLE]: row.audibleId ?? undefined,
      [MetadataProviderKey.LIBROFM]: row.librofmId ?? undefined,
      [MetadataProviderKey.KOBO]: row.koboId ?? undefined,
      [MetadataProviderKey.COMICVINE]: row.comicvineId ?? undefined,
      [MetadataProviderKey.RANOBEDB]: row.ranobedbId ?? undefined,
      [MetadataProviderKey.LUBIMYCZYTAC]: row.lubimyczytacId ?? undefined,
      [MetadataProviderKey.ALADIN]: row.aladinId ?? undefined,
    };
  }

  private async fetchFromProviderWithThrottleHandling(provider: MetadataProvider, params: MetadataSearchParams): Promise<ProviderSearchResult> {
    const startedAt = Date.now();
    this.logger.log(`[metadata_fetch.provider_search] [start] provider=${provider.key} - provider fetch started`);

    try {
      const { results, timedOut } = await this.withTimeout((signal) => this.fetchFromProvider(provider, { ...params, signal }), provider.timeoutMs);

      if (timedOut) {
        this.logger.warn(
          `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=TimeoutError error="provider search timed out" - provider fetch failed`,
        );
        return { candidates: [], outcome: 'timeout' };
      }

      this.throttleTracker.clearOnSuccess(provider.key);
      this.logger.log(
        `[metadata_fetch.provider_search] [end] provider=${provider.key} durationMs=${Date.now() - startedAt} resultCount=${results.length} - provider fetch completed`,
      );
      return { candidates: results, outcome: null };
    } catch (error) {
      if (error instanceof ProviderThrottleError) {
        this.throttleTracker.record(provider.key, error.retryAfterSeconds);
        // A provider throttled part-way through hands back what it had already assembled. The
        // cooldown covers the requests it can no longer make; it is not a reason to drop finished
        // candidates, and the status event still tells the client the provider was cut short.
        const salvaged = filterAndRank([...error.partialCandidates], params);
        this.logger.warn(
          `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} resultCount=${salvaged.length} errorClass=ProviderThrottleError error="provider throttled" - provider fetch failed`,
        );
        return { candidates: salvaged, outcome: 'throttled' };
      }

      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogError(error)}" - provider fetch failed`,
      );
      return { candidates: [], outcome: 'failed' };
    }
  }

  private async fetchFromProvider(provider: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const existingProviderId = params.existingProviderIds?.[provider.key];
    if (isIdentifiable(provider) && existingProviderId) {
      const lookupResult = await provider.lookupById(existingProviderId, params.signal, params);
      if (lookupResult) {
        const rankedLookup = filterAndRank([lookupResult], params, 1);
        if (rankedLookup.length > 0) return rankedLookup;
      }
    }

    return this.searchAndRankProvider(provider, params);
  }

  private async searchAndRankProvider(provider: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const primary = filterAndRank(await provider.search(params), params);
    if (primary.length > 0) return primary;

    const hasIsbn = hasText(params.isbn);
    const hasFallbackTerms = hasText(params.title) || hasText(params.author);
    if (hasIsbn && hasFallbackTerms) {
      const fallbackParams: MetadataSearchParams = { ...params, isbn: undefined };
      const fallback = filterAndRank(await provider.search(fallbackParams), fallbackParams);
      if (fallback.length > 0) return fallback;
    }

    if (params.maxCandidatesPerProvider === undefined && hasText(params.title) && hasText(params.author)) {
      const titleOnlyParams: MetadataSearchParams = { ...params, author: undefined, isbn: undefined };
      return filterAndRank(await provider.search(titleOnlyParams), titleOnlyParams);
    }

    return [];
  }

  private withTimeout(
    run: (signal: AbortSignal) => Promise<MetadataCandidate[]>,
    timeoutMs: number = MetadataFetchService.PROVIDER_TIMEOUT_MS,
  ): Promise<TimedProviderResult> {
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();

    const timeoutPromise = new Promise<TimedProviderResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ results: [], timedOut: true });
      }, timeoutMs);
    });

    const providerPromise = run(controller.signal)
      .then((results) => ({ results, timedOut: false }))
      .catch((error) => {
        if (controller.signal.aborted) {
          return { results: [], timedOut: true };
        }
        throw error;
      });

    return Promise.race([providerPromise, timeoutPromise]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      controller.abort();
    });
  }
}

function toSearchEvents(provider: MetadataProviderKey, result: ProviderSearchResult): MetadataSearchEvent[] {
  const events: MetadataSearchEvent[] = result.candidates.map((candidate) => ({ kind: 'candidate', candidate }));
  if (result.outcome) events.push({ kind: 'status', status: { provider, outcome: result.outcome } });
  return events;
}

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
