import type { AuthorMetadataCandidate, MetadataCacheServedProvider, MetadataCandidateCacheInfo } from '@bookorbit/types';

import type { CacheDirective, ProviderCacheContext } from '../../../common/provider-cache/provider-cache-spec';
import type { LiveFailure, ProviderOperationExecutor, ProviderOperationResult } from '../../metadata-cache/provider-operation-executor.service';
import { authorLookupCodec, authorSearchCodec } from './author-cache-codecs';
import {
  AuthorMetadataProvider,
  AuthorMetadataProviderError,
  AuthorMetadataSearchParams,
  isIdentifiableAuthorProvider,
} from './providers/author-metadata-provider';

export type AuthorRunOutcome<T> = { ok: true; value: T; cache?: MetadataCandidateCacheInfo } | { ok: false; error: unknown };

export function classifyAuthorProviderError(error: unknown): LiveFailure {
  if (error instanceof AuthorMetadataProviderError) {
    const retryAfterMs = error.retryAfterMs ?? 0;
    if (error.httpStatus === 429 || retryAfterMs > 0) {
      return { outcome: 'throttled', retryAfterSeconds: retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : undefined };
    }
  }
  return { outcome: 'failed' };
}

export function authorProviderTimeoutError(): AuthorMetadataProviderError {
  return new AuthorMetadataProviderError('Author metadata provider timeout', { transient: true });
}

/**
 * One provider's share of an author metadata fetch, run through the cache. Each operation gets its
 * own deadline; the executor owns the timed live call, so a timeout can still be answered from the
 * cache. It remembers every result so callers can report provenance and pace outbound traffic.
 */
export class AuthorProviderRun {
  private readonly results: ProviderOperationResult<unknown>[] = [];

  constructor(
    readonly provider: AuthorMetadataProvider,
    private readonly directive: CacheDirective,
    private readonly context: ProviderCacheContext | null,
    private readonly executor: ProviderOperationExecutor,
    private readonly deadline: () => AbortSignal,
  ) {}

  async search(params: AuthorMetadataSearchParams): Promise<AuthorRunOutcome<AuthorMetadataCandidate[]>> {
    const provider = this.provider;
    try {
      const result = await this.executor.execute({
        namespace: 'author',
        provider: provider.key,
        operation: 'search',
        spec: provider.cache,
        context: this.context,
        descriptor: provider.cache?.describeSearch(params) ?? null,
        directive: this.directive,
        signal: this.deadline(),
        codec: authorSearchCodec,
        live: (signal) => provider.search({ ...params, signal }),
        classifyError: classifyAuthorProviderError,
      });
      return this.record(result);
    } catch (error) {
      return { ok: false, error };
    }
  }

  async lookup(providerId: string, params: AuthorMetadataSearchParams): Promise<AuthorRunOutcome<AuthorMetadataCandidate | null>> {
    const provider = this.provider;
    if (!isIdentifiableAuthorProvider(provider)) return { ok: true, value: null };
    try {
      const result = await this.executor.execute({
        namespace: 'author',
        provider: provider.key,
        operation: 'lookup',
        spec: provider.cache,
        context: this.context,
        descriptor: provider.cache?.describeLookup(providerId, params) ?? null,
        directive: this.directive,
        signal: this.deadline(),
        codec: authorLookupCodec,
        live: (signal) => provider.lookupById(providerId, params.region, signal),
        classifyError: classifyAuthorProviderError,
      });
      return this.record(result);
    } catch (error) {
      return { ok: false, error };
    }
  }

  get outboundRequests(): number {
    return this.results.reduce((sum, result) => sum + result.outboundRequests, 0);
  }

  /** Where the cache answered for this provider, merged across its operations. */
  get served(): MetadataCacheServedProvider | null {
    const served = this.results.filter((result) => result.source === 'cache' || result.source === 'fallback');
    if (served.length === 0) return null;
    return {
      provider: this.provider.key,
      source: served.some((result) => result.source === 'fallback') ? 'fallback' : 'cache',
      stale: served.some((result) => result.stale === true),
      cachedAt: served.map((result) => result.cachedAt!).sort()[0]!,
    };
  }

  private record<T>(result: ProviderOperationResult<T>): AuthorRunOutcome<T> {
    this.results.push(result);
    if (result.value !== undefined) return { ok: true, value: result.value, cache: cacheInfo(result) };
    if (result.error !== undefined) return { ok: false, error: result.error };
    return {
      ok: false,
      error:
        result.liveOutcome === 'timeout'
          ? authorProviderTimeoutError()
          : new AuthorMetadataProviderError('Author metadata provider returned no answer', { transient: true }),
    };
  }
}

function cacheInfo(result: ProviderOperationResult<unknown>): MetadataCandidateCacheInfo | undefined {
  if (result.source !== 'cache' && result.source !== 'fallback') return undefined;
  return { fetchedAt: result.cachedAt!, stale: result.stale === true };
}
