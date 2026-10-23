import { Injectable, Logger } from '@nestjs/common';
import type { MetadataCacheEntryStatus, MetadataCacheNamespace } from '@bookorbit/types';

import type { CacheCodec } from '../../common/provider-cache/cache-codec';
import { ProviderCallRecord, runWithProviderCallRecord } from '../../common/provider-cache/provider-call-context';
import type {
  CacheDirective,
  CacheKeyDescriptor,
  CacheOperation,
  ProviderCacheContext,
  ProviderCacheSpec,
} from '../../common/provider-cache/provider-cache-spec';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CACHE_SCHEMA_VERSION, MAX_ENTRY_BYTES } from './metadata-cache.constants';
import {
  effectiveCacheSettings,
  latestMarkerAt,
  MetadataCacheConfigService,
  type ClearMarker,
  type EffectiveCacheSettings,
} from './metadata-cache-config.service';
import { entryFreshness, type EntryFreshness } from './metadata-cache-freshness';
import { buildCacheKey, hashFingerprint } from './metadata-cache-key';
import { MetadataCacheRepository } from './metadata-cache.repository';
import { MetadataCacheSweeper } from './metadata-cache-sweeper.service';
import { MetadataCacheAccessTracker, MetadataCacheBudget, MetadataCacheCounterService } from './metadata-cache-state';

export type LiveOutcome = 'ok' | 'throttled' | 'timeout' | 'failed' | 'skipped';
export type OperationSource = 'live' | 'cache' | 'fallback' | 'none';

export interface LiveFailure {
  outcome: 'throttled' | 'failed';
  retryAfterSeconds?: number;
  /** Results a provider had assembled before it was cut off. */
  partial?: unknown;
}

export interface ProviderOperationRequest<T> {
  namespace: MetadataCacheNamespace;
  provider: string;
  operation: CacheOperation;
  /** Absent for providers that have not opted into caching. */
  spec?: ProviderCacheSpec<unknown>;
  /** Resolved once per provider run by the caller; resolved here when absent. */
  context?: ProviderCacheContext | null;
  descriptor: CacheKeyDescriptor | null;
  directive: CacheDirective;
  /** The caller's deadline. Once aborted the live call is abandoned and a fallback may answer. */
  signal?: AbortSignal;
  codec: CacheCodec<T>;
  live: (signal: AbortSignal) => Promise<T>;
  classifyError: (error: unknown) => LiveFailure;
}

export interface ProviderOperationResult<T> {
  /** Absent when nothing answered. */
  value?: T;
  source: OperationSource;
  cachedAt?: string;
  stale?: boolean;
  liveOutcome: LiveOutcome;
  error?: unknown;
  retryAfterSeconds?: number;
  partial?: unknown;
  /** Outbound requests the live call made, including auxiliary ones; 0 for a cache answer. */
  outboundRequests: number;
  uncacheableReason?: string;
}

interface CachePlan {
  keyHash: string;
  fingerprintHash: string;
  settings: EffectiveCacheSettings;
  markers: ClearMarker[];
  maxBytes: number;
}

interface StoredAnswer<T> {
  value: T;
  freshness: EntryFreshness;
  fetchedAt: Date;
}

type SharedOutcome<T> =
  /** `liveFailed`: the provider answered, but a request it made failed or it reported a failure. */
  | { kind: 'ok'; value: T; liveFailed?: boolean; uncacheableReason?: string }
  | { kind: 'failed'; outcome: LiveFailure['outcome']; error: unknown; retryAfterSeconds?: number; partial?: unknown };

interface SharedOperation<T> {
  keyHash: string;
  maxCandidates: number | null | undefined;
  coverValidation: boolean | undefined;
  controller: AbortController;
  record: ProviderCallRecord;
  waiters: number;
  settled: boolean;
  /** Set as soon as the provider answers, before the cache write the promise also waits for. */
  answered?: Extract<SharedOutcome<T>, { kind: 'ok' }>;
  promise: Promise<SharedOutcome<T>>;
}

interface Verdict {
  cacheable: boolean;
  reason?: string;
  status?: MetadataCacheEntryStatus;
  coversValidated?: boolean;
}

const ABORTED = Symbol('aborted');
const WRITE_FAILURE_LOG_INTERVAL_MS = 60_000;

/**
 * Runs one provider operation (a search or a lookup) under a cache policy. It owns the timed live
 * call so that a timeout can still be answered from the cache, and it reports the live outcome
 * separately from where the answer came from, so callers keep throttle bookkeeping and provider
 * statuses exactly as they would without a cache.
 */
@Injectable()
export class ProviderOperationExecutor {
  private readonly logger = new Logger(ProviderOperationExecutor.name);
  private readonly inFlight = new Map<string, SharedOperation<unknown>[]>();
  private lastWriteFailureLogAt = 0;

  constructor(
    private readonly config: MetadataCacheConfigService,
    private readonly repository: MetadataCacheRepository,
    private readonly counters: MetadataCacheCounterService,
    private readonly budget: MetadataCacheBudget,
    private readonly access: MetadataCacheAccessTracker,
    private readonly sweeper: MetadataCacheSweeper,
  ) {}

  /** Resolves a provider's availability and fingerprint once per run; failures disable caching for the run. */
  async resolveContext(spec: ProviderCacheSpec<unknown> | undefined): Promise<ProviderCacheContext | null> {
    if (!spec) return null;
    try {
      return await spec.context();
    } catch {
      return null;
    }
  }

  async execute<T>(request: ProviderOperationRequest<T>): Promise<ProviderOperationResult<T>> {
    const plan = await this.plan(request);
    if (!plan) {
      // A cache-only request stands in for a provider that must not be called, such as one cooling down.
      if (request.directive.policy === 'only-if-cached') return { source: 'none', liveOutcome: 'skipped', outboundRequests: 0 };
      return this.runUncached(request);
    }

    const { policy } = request.directive;
    let fallbackCandidate: StoredAnswer<T> | null | undefined;

    if (policy === 'default' || policy === 'only-if-cached') {
      const stored = await this.readStored(request, plan, false);
      if (stored?.freshness === 'fresh') return this.answerFromStore(stored, 'cache', plan, 'ok');
      if (policy === 'only-if-cached') {
        if (stored) return this.answerFromStore(stored, 'fallback', plan, 'skipped');
        return { source: 'none', liveOutcome: 'skipped', outboundRequests: 0 };
      }
      fallbackCandidate = stored;
      this.counters.increment('misses');
    }

    if (request.signal?.aborted) {
      return this.afterFailure(request, plan, fallbackCandidate, { kind: 'failed', outcome: 'failed', error: undefined }, 'timeout', 0);
    }

    const shared = this.joinOrStart(request, plan);
    shared.waiters += 1;
    const raced = await raceAbort(shared.promise, request.signal);
    let outcome: SharedOutcome<T>;
    if (raced === ABORTED) {
      // The deadline passed during the cache write: the provider's answer is already in hand.
      if (!shared.answered) {
        this.detach(shared);
        return this.afterFailure(
          request,
          plan,
          fallbackCandidate,
          { kind: 'failed', outcome: 'failed', error: undefined },
          'timeout',
          shared.record.outboundRequests,
        );
      }
      shared.waiters -= 1;
      outcome = shared.answered;
    } else {
      shared.waiters -= 1;
      outcome = raced;
    }

    if (outcome.kind === 'ok') {
      const value = this.fitToRequest(request, outcome.value, shared.maxCandidates);
      if (outcome.liveFailed && request.directive.allowFallback) {
        const fallback = await this.fallbackAfterRecordedFailure(request, plan, fallbackCandidate, value, shared.record.outboundRequests);
        if (fallback) return fallback;
      }
      return {
        value,
        source: 'live',
        liveOutcome: 'ok',
        outboundRequests: shared.record.outboundRequests,
        uncacheableReason: outcome.uncacheableReason,
      };
    }
    return this.afterFailure(request, plan, fallbackCandidate, outcome, outcome.outcome, shared.record.outboundRequests);
  }

  /**
   * A provider that swallows a failed request still answers, usually with nothing. A saved answer
   * is preferred to that, exactly as for a provider that threw. Without one the live answer stands,
   * so a search that worked before the cache existed still does.
   */
  private async fallbackAfterRecordedFailure<T>(
    request: ProviderOperationRequest<T>,
    plan: CachePlan,
    strictCandidate: StoredAnswer<T> | null | undefined,
    liveValue: T,
    outboundRequests: number,
  ): Promise<ProviderOperationResult<T> | null> {
    const stored = strictCandidate ?? (await this.readStored(request, plan, true));
    if (!stored) return null;
    this.counters.increment('fallbacks');
    this.access.record(plan.keyHash);
    return {
      value: stored.value,
      source: 'fallback',
      cachedAt: stored.fetchedAt.toISOString(),
      stale: stored.freshness !== 'fresh',
      liveOutcome: 'failed',
      partial: request.codec.isEmpty(liveValue) ? undefined : liveValue,
      outboundRequests,
    };
  }

  private async plan<T>(request: ProviderOperationRequest<T>): Promise<CachePlan | null> {
    if (!request.spec || !request.descriptor || request.directive.policy === 'bypass') return null;
    if (request.context === null) return null;

    let snapshot;
    try {
      snapshot = await this.config.snapshot();
    } catch {
      this.counters.increment('readFailures');
      return null;
    }
    const settings = effectiveCacheSettings(snapshot.config, request.namespace, request.provider);
    if (!settings.enabled) return null;

    const context = request.context ?? (await this.resolveContext(request.spec));
    if (!context?.available) return null;

    const fingerprintHash = hashFingerprint(context.fingerprint);
    const keyHash = buildCacheKey({
      namespace: request.namespace,
      provider: request.provider,
      providerVersion: request.spec.version,
      operation: request.operation,
      fingerprintHash,
      inputs: request.descriptor.inputs,
    });
    return { keyHash, fingerprintHash, settings, markers: snapshot.markers, maxBytes: snapshot.config.maxStorageMb * 1024 * 1024 };
  }

  /**
   * A stored answer this request may use. A strict read must satisfy the request's result cap and
   * cover validation; a fallback read takes whatever is there, since the provider gave nothing.
   */
  private async readStored<T>(request: ProviderOperationRequest<T>, plan: CachePlan, relaxed: boolean): Promise<StoredAnswer<T> | null> {
    let row;
    try {
      row = await this.repository.find(plan.keyHash);
    } catch {
      this.counters.increment('readFailures');
      return null;
    }
    if (!row) return null;
    if (row.namespace !== request.namespace || row.provider !== request.provider || row.schemaVersion !== CACHE_SCHEMA_VERSION[request.namespace])
      return null;
    if (latestMarkerAt(plan.markers, row.namespace, row.provider, row.status) > row.fetchedAt.getTime()) return null;

    const parsed = this.parsePayload(request, row.payload);
    if (parsed === undefined) {
      void this.repository.delete(plan.keyHash).catch(() => undefined);
      return null;
    }
    let value: T = parsed;

    const descriptor = request.descriptor!;
    if (descriptor.maxCandidates !== undefined) {
      const wanted = descriptor.maxCandidates;
      const stored = row.maxCandidates;
      const holdsEnough = stored === null || (wanted !== null && stored >= wanted);
      if (!holdsEnough && !relaxed) return null;
      if (wanted !== null) value = request.codec.slice(value, wanted);
    }
    if (descriptor.coverValidation === true && !row.coversValidated && !relaxed) return null;

    let freshness: EntryFreshness;
    try {
      freshness = entryFreshness({
        status: row.status,
        fetchedAt: row.fetchedAt,
        keyHash: plan.keyHash,
        publishedDates: request.codec.publishedDates(value),
        settings: plan.settings,
        now: Date.now(),
      });
    } catch {
      // A row this build cannot judge would fail every read of its key until it expired.
      void this.repository.delete(plan.keyHash).catch(() => undefined);
      return null;
    }
    if (freshness === 'expired') return null;
    return { value, freshness, fetchedAt: row.fetchedAt };
  }

  private parsePayload<T>(request: ProviderOperationRequest<T>, payload: string): T | undefined {
    try {
      return request.codec.parse(JSON.parse(payload));
    } catch {
      return undefined;
    }
  }

  private answerFromStore<T>(
    stored: StoredAnswer<T>,
    source: 'cache' | 'fallback',
    plan: CachePlan,
    liveOutcome: LiveOutcome,
  ): ProviderOperationResult<T> {
    this.counters.increment(source === 'cache' ? 'hits' : 'fallbacks');
    this.access.record(plan.keyHash);
    return {
      value: stored.value,
      source,
      cachedAt: stored.fetchedAt.toISOString(),
      stale: stored.freshness !== 'fresh',
      liveOutcome,
      outboundRequests: 0,
    };
  }

  private async afterFailure<T>(
    request: ProviderOperationRequest<T>,
    plan: CachePlan,
    strictCandidate: StoredAnswer<T> | null | undefined,
    failure: Extract<SharedOutcome<T>, { kind: 'failed' }>,
    liveOutcome: LiveOutcome,
    outboundRequests: number,
  ): Promise<ProviderOperationResult<T>> {
    const base = {
      liveOutcome,
      error: failure.error,
      retryAfterSeconds: failure.retryAfterSeconds,
      partial: failure.partial,
      outboundRequests,
    };
    if (request.directive.allowFallback) {
      const stored = strictCandidate ?? (await this.readStored(request, plan, true));
      if (stored) {
        this.counters.increment('fallbacks');
        this.access.record(plan.keyHash);
        return { ...base, value: stored.value, source: 'fallback', cachedAt: stored.fetchedAt.toISOString(), stale: stored.freshness !== 'fresh' };
      }
    }
    return { ...base, source: 'none' };
  }

  private joinOrStart<T>(request: ProviderOperationRequest<T>, plan: CachePlan): SharedOperation<T> {
    const wanted = request.descriptor!;
    const pending = (this.inFlight.get(plan.keyHash) ?? []) as SharedOperation<T>[];
    const joinable = pending.find((shared) => covers(shared, wanted));
    if (joinable) return joinable;

    const shared: SharedOperation<T> = {
      keyHash: plan.keyHash,
      maxCandidates: wanted.maxCandidates,
      coverValidation: wanted.coverValidation,
      controller: new AbortController(),
      record: new ProviderCallRecord(),
      waiters: 0,
      settled: false,
      promise: Promise.resolve({ kind: 'failed', outcome: 'failed', error: undefined }),
    };
    this.counters.increment('liveCalls');
    shared.promise = this.runShared(request, plan, shared);
    this.inFlight.set(plan.keyHash, [...pending, shared] as SharedOperation<unknown>[]);
    return shared;
  }

  /** Settles only after the write, so a repeat request in that window joins instead of missing. */
  private async runShared<T>(request: ProviderOperationRequest<T>, plan: CachePlan, shared: SharedOperation<T>): Promise<SharedOutcome<T>> {
    const startedAt = Date.now();
    try {
      const value = await runWithProviderCallRecord(shared.record, () => request.live(shared.controller.signal));
      // Every caller gave up and the call was cancelled; whatever it returned may be cut short.
      const verdict: Verdict = shared.controller.signal.aborted
        ? { cacheable: false, reason: 'aborted' }
        : this.verdict(request, plan, shared.record, value);
      const liveFailed = verdict.reason === 'request_failed' || verdict.reason === 'provider_failed';
      shared.answered = { kind: 'ok', value, liveFailed };
      let uncacheableReason = verdict.reason;
      if (verdict.cacheable) {
        uncacheableReason = await this.write(request, plan, value, verdict, startedAt);
      } else if (verdict.reason) {
        this.counters.uncacheable(verdict.reason);
      }
      return { kind: 'ok', value, liveFailed, uncacheableReason };
    } catch (error) {
      const failure = request.classifyError(error);
      return { kind: 'failed', outcome: failure.outcome, error, retryAfterSeconds: failure.retryAfterSeconds, partial: failure.partial };
    } finally {
      shared.settled = true;
      this.removeShared(shared);
    }
  }

  private detach<T>(shared: SharedOperation<T>): void {
    shared.waiters -= 1;
    if (shared.waiters > 0 || shared.settled) return;
    shared.controller.abort();
    this.removeShared(shared);
  }

  private removeShared<T>(shared: SharedOperation<T>): void {
    const pending = this.inFlight.get(shared.keyHash);
    if (!pending) return;
    const remaining = pending.filter((entry) => entry !== shared);
    if (remaining.length > 0) this.inFlight.set(shared.keyHash, remaining);
    else this.inFlight.delete(shared.keyHash);
  }

  private verdict<T>(request: ProviderOperationRequest<T>, plan: CachePlan, record: ProviderCallRecord, value: T): Verdict {
    const spec = request.spec!;
    if (record.mainRequests === 0) return { cacheable: false, reason: 'no_upstream' };
    const authoritative = request.operation === 'lookup' ? (spec.authoritativeLookupStatuses ?? []) : [];
    if (record.unsuccessfulRequests(authoritative).length > 0) return { cacheable: false, reason: 'request_failed' };
    if (record.failureReasons.length > 0) return { cacheable: false, reason: 'provider_failed' };
    if (record.degradationReasons.length > 0) return { cacheable: false, reason: 'degraded' };
    if (record.truncated) return { cacheable: false, reason: 'truncated' };

    const empty = request.codec.isEmpty(value);
    if (empty && !spec.trustEmpty) return { cacheable: false, reason: 'untrusted_empty' };
    if (empty && plan.settings.emptyTtlMs === 0) return { cacheable: false, reason: 'empty_not_kept' };

    const status: MetadataCacheEntryStatus = request.operation === 'search' ? (empty ? 'empty' : 'results') : empty ? 'not_found' : 'found';
    return {
      cacheable: true,
      status,
      coversValidated: request.descriptor?.coverValidation === true && record.auxiliaryAllDefinitive,
    };
  }

  /** Returns why the answer was not stored, or undefined when it was. */
  private async write<T>(
    request: ProviderOperationRequest<T>,
    plan: CachePlan,
    value: T,
    verdict: Verdict,
    startedAt: number,
  ): Promise<string | undefined> {
    let payload: string;
    try {
      payload = JSON.stringify(request.codec.sanitize(value));
    } catch {
      this.counters.uncacheable('unserializable');
      return 'unserializable';
    }
    // Only what reads back intact is stored, so a malformed answer is never replayed from the cache.
    if (this.parsePayload(request, payload) === undefined) {
      this.counters.uncacheable('invalid_payload');
      return 'invalid_payload';
    }
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > MAX_ENTRY_BYTES) {
      this.counters.uncacheable('too_large');
      return 'too_large';
    }
    if (!this.budget.admits(plan.maxBytes)) {
      this.counters.increment('skippedWrites');
      this.sweeper.requestSweep('budget');
      return 'over_budget';
    }

    try {
      // Re-read markers: a clear that landed while the live call ran must win over its answer.
      const snapshot = await this.config.snapshot();
      if (latestMarkerAt(snapshot.markers, request.namespace, request.provider, verdict.status!) >= startedAt) {
        this.counters.increment('skippedWrites');
        return 'cleared';
      }
      const now = new Date();
      const grownBytes = await this.repository.upsert({
        keyHash: plan.keyHash,
        namespace: request.namespace,
        provider: request.provider,
        operation: request.operation,
        status: verdict.status!,
        schemaVersion: CACHE_SCHEMA_VERSION[request.namespace],
        providerVersion: request.spec!.version,
        configFingerprint: plan.fingerprintHash,
        maxCandidates: request.descriptor?.maxCandidates ?? null,
        coversValidated: verdict.coversValidated === true,
        payload,
        payloadBytes: bytes,
        fetchedAt: new Date(startedAt),
        lastAccessedAt: now,
        upstreamMs: now.getTime() - startedAt,
      });
      this.counters.increment('writes');
      this.budget.add(grownBytes);
      if (this.budget.needsSweep(plan.maxBytes)) this.sweeper.requestSweep('budget');
      return undefined;
    } catch (error) {
      this.counters.increment('writeFailures');
      this.logWriteFailure(request, error);
      return 'write_failed';
    }
  }

  private async runUncached<T>(request: ProviderOperationRequest<T>): Promise<ProviderOperationResult<T>> {
    if (request.signal?.aborted) return { source: 'none', liveOutcome: 'timeout', outboundRequests: 0 };
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    request.signal?.addEventListener('abort', forwardAbort, { once: true });
    const record = new ProviderCallRecord();
    const live = (async (): Promise<SharedOutcome<T>> => {
      try {
        const value = await runWithProviderCallRecord(record, () => request.live(controller.signal));
        return { kind: 'ok', value };
      } catch (error) {
        const failure = request.classifyError(error);
        return { kind: 'failed', outcome: failure.outcome, error, retryAfterSeconds: failure.retryAfterSeconds, partial: failure.partial };
      }
    })();
    try {
      const outcome = await raceAbort(live, request.signal);
      if (outcome === ABORTED) return { source: 'none', liveOutcome: 'timeout', outboundRequests: record.outboundRequests };
      if (outcome.kind === 'ok') return { value: outcome.value, source: 'live', liveOutcome: 'ok', outboundRequests: record.outboundRequests };
      return {
        source: 'none',
        liveOutcome: outcome.outcome,
        error: outcome.error,
        retryAfterSeconds: outcome.retryAfterSeconds,
        partial: outcome.partial,
        outboundRequests: record.outboundRequests,
      };
    } finally {
      request.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private fitToRequest<T>(request: ProviderOperationRequest<T>, value: T, sharedMax: number | null | undefined): T {
    const wanted = request.descriptor?.maxCandidates;
    if (wanted === undefined || wanted === null || sharedMax === wanted) return value;
    return request.codec.slice(value, wanted);
  }

  private logWriteFailure<T>(request: ProviderOperationRequest<T>, error: unknown): void {
    const now = Date.now();
    if (now - this.lastWriteFailureLogAt < WRITE_FAILURE_LOG_INTERVAL_MS) return;
    this.lastWriteFailureLogAt = now;
    const errorClass = error instanceof Error ? error.name : 'UnknownError';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[metadata_cache.write] [fail] namespace=${request.namespace} provider=${request.provider} errorClass=${errorClass} error="${message}" - cache write failed`,
    );
  }
}

/** A pending operation can serve a request asking for no more results and no stricter cover checks. */
function covers<T>(shared: SharedOperation<T>, wanted: CacheKeyDescriptor): boolean {
  if (wanted.maxCandidates !== undefined) {
    const holds = shared.maxCandidates === null || (wanted.maxCandidates !== null && (shared.maxCandidates ?? 0) >= wanted.maxCandidates);
    if (!holds) return false;
  }
  if (wanted.coverValidation === true && shared.coverValidation !== true) return false;
  return true;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
