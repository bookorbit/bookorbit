import { Injectable } from '@nestjs/common';
import {
  AuthorMetadataCandidate,
  AuthorMetadataProviderInfo,
  AuthorMetadataProviderKey,
  AuthorMetadataSearchCandidateEvent,
  MetadataCacheServedProvider,
  MetadataCandidateCacheInfo,
} from '@bookorbit/types';
import { from, merge, Observable, switchMap, take } from 'rxjs';

import { canonicalId, canonicalText } from '../../../common/provider-cache/canonicalize';
import { DEFAULT_CACHE_DIRECTIVE, type CacheDirective } from '../../../common/provider-cache/provider-cache-spec';
import { ProviderOperationExecutor } from '../../metadata-cache/provider-operation-executor.service';
import { AuthorProviderRun } from './author-provider-run';
import { pickBestAuthorNameMatch } from './author-name-match';
import { AuthorMetadataProviderRegistry } from './provider-registry';
import {
  AuthorMetadataProvider,
  AuthorMetadataProviderError,
  AuthorMetadataSearchParams,
  isIdentifiableAuthorProvider,
} from './providers/author-metadata-provider';
import { canonicalAuthorRegion } from './providers/author-provider-cache';

type SearchOptions = {
  keys?: AuthorMetadataProviderKey[];
  directive?: CacheDirective;
};

type LookupOptions = {
  directive?: CacheDirective;
};

export type AuthorMetadataFetchFailure = {
  provider: AuthorMetadataProviderKey;
  message: string;
  httpStatus: number | null;
  retryAfterMs: number | null;
  transient: boolean;
};

/** Which providers the cache answered for during one call, and how much live traffic it made. */
export type AuthorMetadataFetchProvenance = {
  cacheServed: MetadataCacheServedProvider[];
  outboundRequests: number;
};

export type AuthorQuickSearchResult = AuthorMetadataFetchProvenance & {
  candidate: AuthorMetadataCandidate | null;
  failure: AuthorMetadataFetchFailure | null;
};

export type AuthorMetadataSearchResult = AuthorMetadataFetchProvenance & {
  candidates: AuthorMetadataSearchCandidateEvent[];
};

export type AuthorMetadataLookupResult = AuthorMetadataFetchProvenance & {
  candidate: AuthorMetadataSearchCandidateEvent | null;
};

export type AuthorMetadataCollectResult = AuthorMetadataFetchProvenance & {
  candidates: Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>;
  failures: AuthorMetadataFetchFailure[];
};

type CanonicalSearch = { name: string; region: string; limit: number };

@Injectable()
export class AuthorMetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = 15_000;
  private static readonly QUICK_SEARCH_LIMIT = 8;

  constructor(
    private readonly registry: AuthorMetadataProviderRegistry,
    private readonly executor: ProviderOperationExecutor,
  ) {}

  listProviders(): AuthorMetadataProviderInfo[] {
    return this.registry.all().map((provider) => ({
      key: provider.key,
      label: provider.label,
      identifiable: provider.identifiable,
      supportedFields: [...provider.supportedFields],
    }));
  }

  async search(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorMetadataSearchCandidateEvent[]> {
    return (await this.searchDetailed(params, options)).candidates;
  }

  async searchDetailed(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorMetadataSearchResult> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return { candidates: [], ...summarize([]) };

    const directive = options?.directive ?? DEFAULT_CACHE_DIRECTIVE;
    const query = this.canonicalSearch(params, this.normalizeLimit(params.limit));
    const batches = await Promise.all(
      providers.map(async (provider) => {
        const run = await this.startRun(provider, directive);
        return { run, candidates: await this.searchCandidates(run, query) };
      }),
    );

    return {
      candidates: batches.flatMap((batch) => batch.candidates).slice(0, query.limit),
      ...summarize(batches.map((batch) => batch.run)),
    };
  }

  stream(params: AuthorMetadataSearchParams, options?: SearchOptions): Observable<AuthorMetadataSearchCandidateEvent> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return from([]);

    const directive = options?.directive ?? DEFAULT_CACHE_DIRECTIVE;
    const query = this.canonicalSearch(params, this.normalizeLimit(params.limit));
    return merge(
      ...providers.map((provider) =>
        from(this.startRun(provider, directive).then((run) => this.searchCandidates(run, query))).pipe(
          switchMap((candidates) => from(candidates.slice(0, query.limit))),
        ),
      ),
    ).pipe(take(query.limit));
  }

  async quickSearchDetailed(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorQuickSearchResult> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return { candidate: null, failure: null, ...summarize([]) };

    const directive = options?.directive ?? DEFAULT_CACHE_DIRECTIVE;
    const query = this.canonicalSearch(params, AuthorMetadataFetchService.QUICK_SEARCH_LIMIT);
    const runs: AuthorProviderRun[] = [];
    let lastFailure: AuthorMetadataFetchFailure | null = null;

    for (const provider of providers) {
      const run = await this.startRun(provider, directive);
      runs.push(run);

      const matches = await run.search(query);
      if (!matches.ok) {
        lastFailure = this.toFailure(provider.key, matches.error);
        continue;
      }

      const bestMatch = pickBestAuthorNameMatch(params.name, matches.value);
      if (!bestMatch) continue;

      if (!isIdentifiableAuthorProvider(provider)) {
        return { candidate: bestMatch.candidate, failure: null, ...summarize(runs) };
      }

      const detail = await run.lookup(bestMatch.candidate.providerId, query);
      if (!detail.ok) {
        lastFailure = this.toFailure(provider.key, detail.error);
        continue;
      }

      if (!detail.value) continue;
      const detailedMatch = pickBestAuthorNameMatch(params.name, [detail.value]);
      if (!detailedMatch) continue;

      return { candidate: detailedMatch.candidate, failure: null, ...summarize(runs) };
    }

    return { candidate: null, failure: lastFailure, ...summarize(runs) };
  }

  // Per-field preferences need a candidate from every listed provider, not the
  // first one that answers, so each provider is resolved independently and
  // failures are reported alongside whatever did succeed.
  async collectByProvider(
    params: AuthorMetadataSearchParams,
    keys: AuthorMetadataProviderKey[],
    directive: CacheDirective = DEFAULT_CACHE_DIRECTIVE,
  ): Promise<AuthorMetadataCollectResult> {
    const candidates = new Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>();
    const failures: AuthorMetadataFetchFailure[] = [];
    const cacheServed: MetadataCacheServedProvider[] = [];
    let outboundRequests = 0;

    for (const key of keys) {
      if (!this.registry.find(key)) continue;
      const result = await this.quickSearchDetailed(params, { keys: [key], directive });
      if (result.candidate) candidates.set(key, result.candidate);
      if (result.failure) failures.push(result.failure);
      cacheServed.push(...result.cacheServed);
      outboundRequests += result.outboundRequests;
    }

    return { candidates, failures, cacheServed, outboundRequests };
  }

  async lookupById(
    key: AuthorMetadataProviderKey,
    providerId: string,
    region?: string,
    options?: LookupOptions,
  ): Promise<AuthorMetadataSearchCandidateEvent | null> {
    return (await this.lookupByIdDetailed(key, providerId, region, options)).candidate;
  }

  async lookupByIdDetailed(
    key: AuthorMetadataProviderKey,
    providerId: string,
    region?: string,
    options?: LookupOptions,
  ): Promise<AuthorMetadataLookupResult> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiableAuthorProvider(provider)) return { candidate: null, ...summarize([]) };

    const run = await this.startRun(provider, options?.directive ?? DEFAULT_CACHE_DIRECTIVE);
    const outcome = await run.lookup(canonicalId(providerId) ?? '', { name: '', region: canonicalAuthorRegion(region) });
    const candidate = outcome.ok && outcome.value ? withCache(outcome.value, outcome.cache) : null;
    return { candidate, ...summarize([run]) };
  }

  /** The per-operation deadline; today's provider timeout, now enforced by the executor. */
  protected createDeadline(): AbortSignal {
    return AbortSignal.timeout(AuthorMetadataFetchService.PROVIDER_TIMEOUT_MS);
  }

  private async startRun(provider: AuthorMetadataProvider, directive: CacheDirective): Promise<AuthorProviderRun> {
    const context = await this.executor.resolveContext(provider.cache);
    return new AuthorProviderRun(provider, directive, context, this.executor, () => this.createDeadline());
  }

  private async searchCandidates(run: AuthorProviderRun, query: CanonicalSearch): Promise<AuthorMetadataSearchCandidateEvent[]> {
    const outcome = await run.search(query);
    if (!outcome.ok) return [];
    return outcome.value.map((candidate) => withCache(candidate, outcome.cache));
  }

  /** The canonical name and region are what both the cache key and the provider request use. */
  private canonicalSearch(params: AuthorMetadataSearchParams, limit: number): CanonicalSearch {
    return {
      name: canonicalText(params.name) ?? '',
      region: canonicalAuthorRegion(params.region),
      limit,
    };
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return 10;
    const numeric = Number(limit);
    return Math.max(1, Math.min(25, Math.floor(numeric)));
  }

  private toFailure(provider: AuthorMetadataProviderKey, error: unknown): AuthorMetadataFetchFailure {
    if (error instanceof AuthorMetadataProviderError) {
      return {
        provider,
        message: error.message,
        httpStatus: error.httpStatus,
        retryAfterMs: error.retryAfterMs,
        transient: error.transient,
      };
    }

    return {
      provider,
      message: error instanceof Error ? error.message : 'Unknown provider error',
      httpStatus: null,
      retryAfterMs: null,
      transient: true,
    };
  }
}

function withCache(candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | undefined): AuthorMetadataSearchCandidateEvent {
  return cache ? { ...candidate, cache } : candidate;
}

function summarize(runs: readonly AuthorProviderRun[]): AuthorMetadataFetchProvenance {
  return {
    cacheServed: runs.map((run) => run.served).filter((served): served is MetadataCacheServedProvider => served !== null),
    outboundRequests: runs.reduce((sum, run) => sum + run.outboundRequests, 0),
  };
}
