import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';
import { from, merge, Observable, switchMap } from 'rxjs';

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

@Injectable()
export class MetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = PROVIDER_TIMEOUTS.SCRAPE;
  private readonly logger = new Logger(MetadataFetchService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly metadataFetchRepository: MetadataFetchRepository,
  ) {}

  search(params: MetadataSearchParams, keys?: MetadataProviderKey[]): Observable<MetadataCandidate> {
    const providers = this.registry.select(keys);
    return merge(
      ...providers.map((provider) =>
        from(this.fetchFromProviderWithThrottleHandling(provider, params)).pipe(switchMap((providerResults) => from(providerResults))),
      ),
    );
  }

  async lookupById(key: MetadataProviderKey, providerId: string): Promise<MetadataCandidate | null> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiable(provider)) return null;
    return provider.lookupById(providerId);
  }

  async getStoredProviderIds(bookId: number, user: RequestUser): Promise<Partial<Record<MetadataProviderKey, string>>> {
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

    return this.mapStoredProviderIds(row);
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
      [MetadataProviderKey.COMICVINE]: row.comicvineId ?? undefined,
      [MetadataProviderKey.RANOBEDB]: row.ranobedbId ?? undefined,
    };
  }

  private async fetchFromProviderWithThrottleHandling(provider: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const startedAt = Date.now();
    this.logger.log(`[metadata_fetch.provider_search] [start] provider=${provider.key} - provider fetch started`);

    try {
      const { results, timedOut } = await this.withTimeout((signal) => this.fetchFromProvider(provider, { ...params, signal }));

      if (timedOut) {
        this.logger.warn(
          `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=TimeoutError error="provider search timed out" - provider fetch failed`,
        );
        return [];
      }

      this.throttleTracker.clearOnSuccess(provider.key);
      this.logger.log(
        `[metadata_fetch.provider_search] [end] provider=${provider.key} durationMs=${Date.now() - startedAt} resultCount=${results.length} - provider fetch completed`,
      );
      return results;
    } catch (error) {
      if (error instanceof ProviderThrottleError) {
        this.throttleTracker.record(provider.key, error.retryAfterSeconds);
        this.logger.warn(
          `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=ProviderThrottleError error="provider throttled" - provider fetch failed`,
        );
        return [];
      }

      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogError(error)}" - provider fetch failed`,
      );
      return [];
    }
  }

  private async fetchFromProvider(provider: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const existingProviderId = params.existingProviderIds?.[provider.key];
    if (isIdentifiable(provider) && existingProviderId) {
      const lookupResult = await provider.lookupById(existingProviderId, params.signal);
      return lookupResult ? [lookupResult] : [];
    }

    const primary = filterAndRank(await provider.search(params), params);
    const hasIsbn = hasText(params.isbn);
    if (!hasIsbn) return primary;

    if (primary.length > 0) return primary;

    const hasFallbackTerms = hasText(params.title) || hasText(params.author);
    if (!hasFallbackTerms) return [];

    const fallbackParams: MetadataSearchParams = { ...params, isbn: undefined };
    return filterAndRank(await provider.search(fallbackParams), fallbackParams);
  }

  private withTimeout(run: (signal: AbortSignal) => Promise<MetadataCandidate[]>): Promise<TimedProviderResult> {
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();

    const timeoutPromise = new Promise<TimedProviderResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ results: [], timedOut: true });
      }, MetadataFetchService.PROVIDER_TIMEOUT_MS);
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

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
