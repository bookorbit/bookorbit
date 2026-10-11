import type { MetadataCacheServedProvider, MetadataCandidate, MetadataCandidateCacheInfo, MetadataProviderSearchOutcome } from '@bookorbit/types';

import type { CacheDirective, ProviderCacheContext } from '../../common/provider-cache/provider-cache-spec';
import type { LiveFailure, ProviderOperationExecutor, ProviderOperationResult } from '../metadata-cache/provider-operation-executor.service';
import { bookLookupCodec, bookSearchCodec } from './metadata-cache-codecs';
import { ProviderThrottleError } from './provider-throttle.error';
import { isIdentifiable, MetadataProvider } from './providers/metadata-provider';
import { MetadataSearchParams } from './providers/metadata-search-params';

export interface RunOperation<T> {
  value: T | undefined;
  /** Set when the answer came from the cache rather than the provider. */
  cache?: MetadataCandidateCacheInfo;
  /** The live call failed, timed out or was throttled; the run makes no further calls. */
  stopped: boolean;
}

export function classifyBookProviderError(error: unknown): LiveFailure {
  if (error instanceof ProviderThrottleError) {
    return { outcome: 'throttled', retryAfterSeconds: error.retryAfterSeconds, partial: error.partialCandidates };
  }
  return { outcome: 'failed' };
}

/**
 * One provider's share of a metadata search: its lookups and searches, run through the cache under a
 * single deadline. It remembers how each call ended so the service can keep throttle bookkeeping and
 * provider statuses exactly as they were before the cache existed.
 */
export class ProviderRun {
  private readonly results: ProviderOperationResult<unknown>[] = [];

  constructor(
    readonly provider: MetadataProvider,
    readonly params: MetadataSearchParams,
    private readonly directive: CacheDirective,
    private readonly context: ProviderCacheContext | null,
    private readonly signal: AbortSignal,
    private readonly executor: ProviderOperationExecutor,
  ) {}

  async search(params: MetadataSearchParams): Promise<RunOperation<MetadataCandidate[]>> {
    const result = await this.executor.execute({
      namespace: 'book',
      provider: this.provider.key,
      operation: 'search',
      spec: this.provider.cache,
      context: this.context,
      descriptor: this.provider.cache?.describeSearch(params) ?? null,
      directive: this.directive,
      signal: this.signal,
      codec: bookSearchCodec,
      live: (signal) => this.provider.search({ ...params, signal }),
      classifyError: classifyBookProviderError,
    });
    this.results.push(result);
    let value = result.value;
    // A provider throttled part-way hands back what it had; a stored complete answer is preferred.
    if (value === undefined && result.liveOutcome === 'throttled' && Array.isArray(result.partial)) {
      value = result.partial as MetadataCandidate[];
    }
    return { value, cache: cacheInfo(result), stopped: isStopped(result) };
  }

  async lookup(providerId: string, params: MetadataSearchParams | undefined): Promise<RunOperation<MetadataCandidate | null>> {
    const provider = this.provider;
    if (!isIdentifiable(provider)) return { value: undefined, stopped: false };
    const result = await this.executor.execute({
      namespace: 'book',
      provider: provider.key,
      operation: 'lookup',
      spec: provider.cache,
      context: this.context,
      descriptor: provider.cache?.describeLookup(providerId, params) ?? null,
      directive: this.directive,
      signal: this.signal,
      codec: bookLookupCodec,
      live: (signal) => provider.lookupById(providerId, signal, params),
      classifyError: classifyBookProviderError,
    });
    this.results.push(result);
    return { value: result.value, cache: cacheInfo(result), stopped: isStopped(result) };
  }

  /** How the provider stopped, if it did; a throttle outranks a timeout, which outranks a failure. */
  get outcome(): MetadataProviderSearchOutcome | null {
    const outcomes = new Set(this.results.map((result) => result.liveOutcome));
    if (outcomes.has('throttled')) return 'throttled';
    if (outcomes.has('timeout')) return 'timeout';
    if (outcomes.has('failed')) return 'failed';
    return null;
  }

  get retryAfterSeconds(): number | undefined {
    return this.results.find((result) => result.liveOutcome === 'throttled')?.retryAfterSeconds;
  }

  /** At least one live call completed cleanly. A cache answer says nothing about provider health. */
  get liveSucceeded(): boolean {
    return this.results.some((result) => result.source === 'live' && result.liveOutcome === 'ok');
  }

  get firstError(): unknown {
    return this.results.find((result) => result.error !== undefined)?.error;
  }

  get outboundRequests(): number {
    return this.results.reduce((sum, result) => sum + result.outboundRequests, 0);
  }

  /** Where the cache answered for this provider, summarised for diagnostics. */
  get served(): MetadataCacheServedProvider | null {
    const served = this.results.filter((result) => result.source === 'cache' || result.source === 'fallback');
    if (served.length === 0) return null;
    const cachedAt = served.map((result) => result.cachedAt!).sort()[0];
    return {
      provider: this.provider.key,
      source: served.some((result) => result.source === 'fallback') ? 'fallback' : 'cache',
      stale: served.some((result) => result.stale === true),
      cachedAt,
    };
  }

  get sources(): string {
    const sources = [...new Set(this.results.map((result) => result.source))];
    return sources.length === 0 ? 'none' : sources.join('|');
  }
}

function cacheInfo(result: ProviderOperationResult<unknown>): MetadataCandidateCacheInfo | undefined {
  if (result.source !== 'cache' && result.source !== 'fallback') return undefined;
  return { fetchedAt: result.cachedAt!, stale: result.stale === true };
}

function isStopped(result: ProviderOperationResult<unknown>): boolean {
  return result.liveOutcome === 'throttled' || result.liveOutcome === 'timeout' || result.liveOutcome === 'failed';
}
