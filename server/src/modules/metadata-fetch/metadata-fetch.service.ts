import { Inject, Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { from, merge, Observable, switchMap } from 'rxjs';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata } from '../../db/schema';
import { filterAndRank } from './candidate-relevance';
import { ProviderThrottleError } from './provider-throttle.error';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { ProviderRegistry } from './provider-registry';
import { isIdentifiable, MetadataProvider } from './providers/metadata-provider';
import { MetadataSearchParams } from './providers/metadata-search-params';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class MetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(MetadataFetchService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    @Inject(DB) private readonly db: Db,
  ) {}

  search(params: MetadataSearchParams, keys?: MetadataProviderKey[]): Observable<MetadataCandidate> {
    const providers = this.registry.select(keys);
    return merge(...providers.map((p) => from(this.fetchFromProviderWithThrottleHandling(p, params)).pipe(switchMap((results) => from(results)))));
  }

  async lookupById(key: MetadataProviderKey, providerId: string): Promise<MetadataCandidate | null> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiable(provider)) return null;
    return provider.lookupById(providerId);
  }

  async getStoredProviderIds(bookId: number): Promise<Partial<Record<MetadataProviderKey, string>>> {
    const row = await this.db.query.bookMetadata.findFirst({
      where: eq(bookMetadata.bookId, bookId),
      columns: {
        googleBooksId: true,
        goodreadsId: true,
        amazonId: true,
        hardcoverId: true,
        openLibraryId: true,
        itunesId: true,
        audibleId: true,
        comicvineId: true,
      },
    });
    if (!row) return {};
    return {
      [MetadataProviderKey.GOOGLE]: row.googleBooksId ?? undefined,
      [MetadataProviderKey.GOODREADS]: row.goodreadsId ?? undefined,
      [MetadataProviderKey.AMAZON]: row.amazonId ?? undefined,
      [MetadataProviderKey.HARDCOVER]: row.hardcoverId ?? undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: row.openLibraryId ?? undefined,
      [MetadataProviderKey.ITUNES]: row.itunesId ?? undefined,
      [MetadataProviderKey.AUDIBLE]: row.audibleId ?? undefined,
      [MetadataProviderKey.COMICVINE]: row.comicvineId ?? undefined,
    };
  }

  private async fetchFromProviderWithThrottleHandling(p: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    try {
      const results = await this.withTimeout(this.fetchFromProvider(p, params));
      this.throttleTracker.clearOnSuccess(p.key);
      return results;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        const hint = err.retryAfterSeconds != null ? `${err.retryAfterSeconds}s (Retry-After header)` : 'scheduled backoff';
        this.logger.warn(`[${p.key}] throttled by provider - ${hint}`);
        this.throttleTracker.record(p.key, err.retryAfterSeconds);
      }
      return [];
    }
  }

  private async fetchFromProvider(p: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const existingId = params.existingProviderIds?.[p.key];
    if (isIdentifiable(p) && existingId) {
      return p.lookupById(existingId).then((r) => (r ? [r] : []));
    }

    const primary = filterAndRank(await p.search(params), params);
    const hasIsbn = hasText(params.isbn);
    if (!hasIsbn) return primary;

    if (primary.length > 0) {
      this.logger.log(`[${p.key}] ISBN search returned ${primary.length} result(s); no fallback`);
      return primary;
    }

    const hasFallbackTerms = hasText(params.title) || hasText(params.author);
    if (!hasFallbackTerms) {
      this.logger.log(`[${p.key}] ISBN search returned no results and no title/author available; no fallback`);
      return [];
    }

    this.logger.log(`[${p.key}] ISBN search returned no results; falling back to non-ISBN search`);
    const fallbackParams: MetadataSearchParams = { ...params, isbn: undefined };
    const fallback = filterAndRank(await p.search(fallbackParams), fallbackParams);
    this.logger.log(`[${p.key}] Non-ISBN fallback ${fallback.length > 0 ? `returned ${fallback.length} result(s)` : 'returned no results'}`);
    return fallback;
  }

  private withTimeout(promise: Promise<MetadataCandidate[]>): Promise<MetadataCandidate[]> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<MetadataCandidate[]>((resolve) => {
      timer = setTimeout(() => resolve([]), MetadataFetchService.PROVIDER_TIMEOUT_MS);
    });
    return Promise.race([
      promise.catch((err: unknown) => {
        if (err instanceof ProviderThrottleError) throw err;
        return [] as MetadataCandidate[];
      }),
      timeout,
    ]).finally(() => clearTimeout(timer!));
  }
}

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
