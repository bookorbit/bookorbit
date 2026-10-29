import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  CoverMedia,
  MetadataCacheServedProvider,
  MetadataCandidate,
  MetadataCandidateCacheInfo,
  MetadataProviderKey,
  MetadataProviderSearchOutcome,
  MetadataProviderSearchStatus,
} from '@bookorbit/types';
import { filter, from, map, merge, Observable, switchMap } from 'rxjs';

import { canonicalId } from '../../common/provider-cache/canonicalize';
import { DEFAULT_CACHE_DIRECTIVE, type CacheDirective } from '../../common/provider-cache/provider-cache-spec';
import type { RequestUser } from '../../common/types/request-user';
import { resolveTextMediaKind } from '../../common/utils/book-media.utils';
import { ProviderOperationExecutor } from '../metadata-cache/provider-operation-executor.service';
import { filterAndRank } from './candidate-relevance';
import { MetadataFetchRepository, StoredProviderIdsRow } from './metadata-fetch.repository';
import { ProviderIdStore } from './provider-ids/provider-id.store';
import { ProviderRun, type RunOperation } from './metadata-provider-run';
import { canonicalizeSearchParams } from './metadata-search-canonical';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { ProviderRegistry } from './provider-registry';
import { PROVIDER_TIMEOUT_MS as PROVIDER_TIMEOUTS } from './providers/provider-constants';
import { isIdentifiable, MetadataProvider } from './providers/metadata-provider';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { sanitizeLogError } from './providers/provider-utils';

/** Last-resort guard for a provider that ignores its abort signal; the run deadline normally ends first. */
const HARD_GUARD_MARGIN_MS = 2_000;
const HARD_GUARD_HIT = Symbol('hard-guard');

interface RankedCandidate {
  candidate: MetadataCandidate;
  cache?: MetadataCandidateCacheInfo;
}

/** What one provider contributed to a search, for callers that track cache use and pacing. */
export interface ProviderRunSummary {
  provider: MetadataProviderKey;
  served: MetadataCacheServedProvider | null;
  outboundRequests: number;
}

interface ProviderSearchResult {
  candidates: RankedCandidate[];
  /** Null when the provider ran to completion, whether or not it found anything. */
  outcome: MetadataProviderSearchOutcome | null;
  run: ProviderRunSummary;
}

/**
 * A search reports the records it found, whether a provider was cut off before it could finish, and
 * (for internal callers) how each provider's run used the cache. Without the second, an interrupted
 * search is indistinguishable from a genuinely empty one.
 */
export type MetadataSearchEvent =
  | { kind: 'candidate'; candidate: MetadataCandidate; cache?: MetadataCandidateCacheInfo }
  | { kind: 'status'; status: MetadataProviderSearchStatus }
  | { kind: 'run'; run: ProviderRunSummary };

export interface MetadataSearchOptions {
  directive?: CacheDirective;
  /** Per-provider overrides, e.g. answering providers in cooldown from the cache only. */
  directiveByProvider?: Partial<Record<MetadataProviderKey, CacheDirective>>;
}

export interface MetadataLookupResult {
  candidate: MetadataCandidate;
  cache?: MetadataCandidateCacheInfo;
}

export interface StoredProviderContext {
  libraryId: number;
  title: string | null;
  seriesName: string | null;
  seriesIndex: string | null;
  providerIds: Partial<Record<MetadataProviderKey, string>>;
  coverMedia: CoverMedia;
  /** What the book is read as, audio aside; undefined when no file says. */
  textMediaKind: 'ebook' | 'comic' | undefined;
}

@Injectable()
export class MetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = PROVIDER_TIMEOUTS.SCRAPE;
  private readonly logger = new Logger(MetadataFetchService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly metadataFetchRepository: MetadataFetchRepository,
    private readonly executor: ProviderOperationExecutor,
    @Optional() private readonly providerIdStore?: ProviderIdStore,
  ) {}

  search(params: MetadataSearchParams, keys?: MetadataProviderKey[], options?: MetadataSearchOptions): Observable<MetadataSearchEvent> {
    const providers = this.registry.select(keys);
    const canonical = canonicalizeSearchParams(params);
    return merge(
      ...providers.map((provider) =>
        from(this.runProvider(provider, canonical, directiveFor(provider.key, options))).pipe(
          switchMap((result) => from(toSearchEvents(provider.key, result))),
        ),
      ),
    );
  }

  /** Candidate-only view of `search`, for callers that have no use for provider status. */
  searchCandidates(params: MetadataSearchParams, keys?: MetadataProviderKey[], options?: MetadataSearchOptions): Observable<MetadataCandidate> {
    return this.search(params, keys, options).pipe(
      filter((event): event is Extract<MetadataSearchEvent, { kind: 'candidate' }> => event.kind === 'candidate'),
      map((event) => event.candidate),
    );
  }

  async lookupById(key: MetadataProviderKey, providerId: string, options?: { directive?: CacheDirective }): Promise<MetadataLookupResult | null> {
    const provider = this.registry.find(key);
    const id = canonicalId(providerId);
    if (!provider || !isIdentifiable(provider) || !id) return null;

    const timeoutMs = this.timeoutFor(provider);
    const context = await this.executor.resolveContext(provider.cache);
    const deadline = createDeadline(timeoutMs);
    const run = new ProviderRun(provider, {}, options?.directive ?? DEFAULT_CACHE_DIRECTIVE, context, deadline.signal, this.executor);
    try {
      const lookup = await withHardGuard(run.lookup(id, undefined), timeoutMs + HARD_GUARD_MARGIN_MS);
      if (lookup === HARD_GUARD_HIT) return null;
      this.recordThrottleOutcome(provider.key, run);
      if (!lookup.value) return null;
      return { candidate: withCoverShape(provider, lookup.value), ...(lookup.cache ? { cache: lookup.cache } : {}) };
    } finally {
      deadline.dispose();
    }
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
      providerIds: { ...this.mapStoredProviderIds(row), ...(await this.providerIdStore?.read(bookId)) },
      coverMedia: row.coverMedia,
      textMediaKind: resolveTextMediaKind(row.mediaFiles, row.primaryFileId),
    };
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

  private timeoutFor(provider: MetadataProvider): number {
    return provider.timeoutMs ?? MetadataFetchService.PROVIDER_TIMEOUT_MS;
  }

  private async runProvider(provider: MetadataProvider, params: MetadataSearchParams, directive: CacheDirective): Promise<ProviderSearchResult> {
    const startedAt = Date.now();
    this.logger.log(`[metadata_fetch.provider_search] [start] provider=${provider.key} policy=${directive.policy} - provider fetch started`);

    const timeoutMs = this.timeoutFor(provider);
    const context = await this.executor.resolveContext(provider.cache);
    const deadline = createDeadline(timeoutMs);
    const run = new ProviderRun(provider, params, directive, context, deadline.signal, this.executor);
    const summary = (): ProviderRunSummary => ({ provider: provider.key, served: run.served, outboundRequests: run.outboundRequests });

    try {
      const ranked = await withHardGuard(this.fetchFromProvider(run), timeoutMs + HARD_GUARD_MARGIN_MS);
      if (ranked === HARD_GUARD_HIT) {
        this.logger.warn(
          `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=TimeoutError error="provider ignored its deadline" - provider fetch failed`,
        );
        return { candidates: [], outcome: 'timeout', run: summary() };
      }

      this.recordThrottleOutcome(provider.key, run);
      const candidates = ranked.map((entry) => ({ ...entry, candidate: withCoverShape(provider, entry.candidate) }));
      const outcome = run.outcome;
      this.logRunEnd(provider, run, startedAt, candidates.length, outcome);
      return { candidates, outcome, run: summary() };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogError(error)}" - provider fetch failed`,
      );
      return { candidates: [], outcome: 'failed', run: summary() };
    } finally {
      deadline.dispose();
    }
  }

  /** Cooldowns are recorded from live outcomes only; a cache answer neither starts nor clears one. */
  private recordThrottleOutcome(key: MetadataProviderKey, run: ProviderRun): void {
    if (run.outcome === 'throttled') {
      this.throttleTracker.record(key, run.retryAfterSeconds);
      return;
    }
    if (run.liveSucceeded) this.throttleTracker.clearOnSuccess(key);
  }

  private logRunEnd(
    provider: MetadataProvider,
    run: ProviderRun,
    startedAt: number,
    resultCount: number,
    outcome: MetadataProviderSearchOutcome | null,
  ): void {
    const durationMs = Date.now() - startedAt;
    const cache = `source=${run.sources} outbound=${run.outboundRequests}`;
    if (outcome === null) {
      this.logger.log(
        `[metadata_fetch.provider_search] [end] provider=${provider.key} durationMs=${durationMs} resultCount=${resultCount} ${cache} - provider fetch completed`,
      );
      return;
    }
    const errorClass = outcome === 'throttled' ? 'ProviderThrottleError' : outcome === 'timeout' ? 'TimeoutError' : errorClassOf(run.firstError);
    const error =
      outcome === 'throttled' ? 'provider throttled' : outcome === 'timeout' ? 'provider search timed out' : sanitizeLogError(run.firstError);
    this.logger.warn(
      `[metadata_fetch.provider_search] [fail] provider=${provider.key} durationMs=${durationMs} resultCount=${resultCount} ${cache} errorClass=${errorClass} error="${error}" - provider fetch failed`,
    );
  }

  private async fetchFromProvider(run: ProviderRun): Promise<RankedCandidate[]> {
    const { provider, params } = run;
    const existingProviderId = params.existingProviderIds?.[provider.key];
    if (isIdentifiable(provider) && existingProviderId) {
      const lookup = await run.lookup(existingProviderId, params);
      if (lookup.value) {
        const rankedLookup = filterAndRank([lookup.value], params, 1);
        if (rankedLookup.length > 0) return withCacheInfo(rankedLookup, lookup);
      }
      if (lookup.stopped || params.existingProviderIdsOnly) return [];
    }

    if (params.existingProviderIdsOnly) {
      if (provider.key !== MetadataProviderKey.AUDNEXUS || !params.existingProviderIds?.[MetadataProviderKey.AUDIBLE]) return [];
      const found = await run.search(params);
      return withCacheInfo(filterAndRank(found.value ?? [], params, 1), found);
    }

    return this.searchAndRankProvider(run);
  }

  private async searchAndRankProvider(run: ProviderRun): Promise<RankedCandidate[]> {
    const { params } = run;
    const limit = params.resultsPerProvider;
    const primary = await run.search(params);
    const primaryRanked = filterAndRank(primary.value ?? [], params, limit);
    if (primaryRanked.length > 0 || primary.stopped) return withCacheInfo(primaryRanked, primary);

    const hasIsbn = hasText(params.isbn);
    const hasFallbackTerms = hasText(params.title) || hasText(params.author);
    if (hasIsbn && hasFallbackTerms) {
      const fallbackParams: MetadataSearchParams = { ...params, isbn: undefined };
      const fallback = await run.search(fallbackParams);
      const fallbackRanked = filterAndRank(fallback.value ?? [], fallbackParams, limit);
      if (fallbackRanked.length > 0 || fallback.stopped) return withCacheInfo(fallbackRanked, fallback);
    }

    if (params.maxCandidatesPerProvider === undefined && hasText(params.title) && hasText(params.author)) {
      const titleOnlyParams: MetadataSearchParams = { ...params, author: undefined, isbn: undefined };
      const titleOnly = await run.search(titleOnlyParams);
      return withCacheInfo(filterAndRank(titleOnly.value ?? [], titleOnlyParams, limit), titleOnly);
    }

    return [];
  }
}

function directiveFor(key: MetadataProviderKey, options: MetadataSearchOptions | undefined): CacheDirective {
  return options?.directiveByProvider?.[key] ?? options?.directive ?? DEFAULT_CACHE_DIRECTIVE;
}

/** A provider run's budget. Uses `setTimeout` (not `AbortSignal.timeout`) so it is cleared when the run ends. */
function createDeadline(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

function withCacheInfo(candidates: MetadataCandidate[], operation: RunOperation<unknown>): RankedCandidate[] {
  return candidates.map((candidate) => (operation.cache ? { candidate, cache: operation.cache } : { candidate }));
}

async function withHardGuard<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof HARD_GUARD_HIT> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<typeof HARD_GUARD_HIT>((resolve) => {
    timer = setTimeout(() => resolve(HARD_GUARD_HIT), timeoutMs);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Every candidate with a cover states its shape, so neither the pipeline nor a client has to guess. */
function withCoverShape(provider: MetadataProvider, candidate: MetadataCandidate): MetadataCandidate {
  if (!candidate.coverUrl || candidate.coverShape) return candidate;
  return { ...candidate, coverShape: provider.coverShape ?? 'unknown' };
}

function toSearchEvents(provider: MetadataProviderKey, result: ProviderSearchResult): MetadataSearchEvent[] {
  const events: MetadataSearchEvent[] = result.candidates.map(({ candidate, cache }) =>
    cache ? { kind: 'candidate', candidate, cache } : { kind: 'candidate', candidate },
  );
  if (result.outcome) events.push({ kind: 'status', status: { provider, outcome: result.outcome } });
  events.push({ kind: 'run', run: result.run });
  return events;
}

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
