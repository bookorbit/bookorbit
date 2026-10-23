import type { CacheCodec } from '../../common/provider-cache/cache-codec';
import {
  recordAuxiliaryProviderRequest,
  recordProviderRequest,
  markProviderDegraded,
  markProviderFailed,
  markProviderTruncated,
} from '../../common/provider-cache/provider-call-context';
import type { CacheDirective, CacheKeyDescriptor, ProviderCacheSpec } from '../../common/provider-cache/provider-cache-spec';
import type { ProviderOperationRequest } from './provider-operation-executor.service';
import { createTestExecutor, type TestExecutorHarness } from './test-helpers';

interface Item {
  id: string;
  publishedDate?: string;
}

const codec: CacheCodec<Item[]> = {
  isEmpty: (value) => value.length === 0,
  sanitize: (value) => value.map(({ id, publishedDate }) => ({ id, ...(publishedDate ? { publishedDate } : {}) })),
  parse: (payload) => (Array.isArray(payload) && payload.every((item) => typeof (item as Item).id === 'string') ? (payload as Item[]) : undefined),
  slice: (value, max) => value.slice(0, max),
  publishedDates: (value) => value.flatMap((item) => (item.publishedDate ? [item.publishedDate] : [])),
};

function makeSpec(overrides: Partial<ProviderCacheSpec<unknown>> = {}): ProviderCacheSpec<unknown> {
  return {
    version: 1,
    trustEmpty: false,
    context: () => Promise.resolve({ available: true, fingerprint: '{}' }),
    describeSearch: () => ({ inputs: {} }),
    describeLookup: () => ({ inputs: {} }),
    ...overrides,
  };
}

const DEFAULT: CacheDirective = { policy: 'default', allowFallback: true };
const DAY = 24 * 60 * 60 * 1000;

/** A live call that records one successful request, so its answer counts as complete. */
function ok(value: Item[], status = 200) {
  return vi.fn(() => {
    recordProviderRequest('GET https://example.test/q', { kind: 'status', status });
    return Promise.resolve(value);
  });
}

describe('ProviderOperationExecutor', () => {
  let harness: TestExecutorHarness;

  beforeEach(() => {
    harness = createTestExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function request(
    live: (signal: AbortSignal) => Promise<Item[]>,
    overrides: Partial<ProviderOperationRequest<Item[]>> = {},
    descriptor: CacheKeyDescriptor = { inputs: { title: 'Dune' } },
  ): ProviderOperationRequest<Item[]> {
    return {
      namespace: 'book',
      provider: 'google',
      operation: 'search',
      spec: makeSpec(),
      descriptor,
      directive: DEFAULT,
      codec,
      live,
      classifyError: (error) =>
        error instanceof Error && error.message === 'throttled'
          ? { outcome: 'throttled', retryAfterSeconds: 60, partial: [{ id: 'p' }] }
          : { outcome: 'failed' },
      ...overrides,
    };
  }

  it('answers a repeat call from the cache after a complete live answer', async () => {
    const live = ok([{ id: 'a' }]);

    const first = await harness.executor.execute(request(live));
    const second = await harness.executor.execute(request(live));

    expect(first).toMatchObject({ source: 'live', liveOutcome: 'ok', value: [{ id: 'a' }], outboundRequests: 1 });
    expect(second).toMatchObject({ source: 'cache', liveOutcome: 'ok', value: [{ id: 'a' }], stale: false, outboundRequests: 0 });
    expect(live).toHaveBeenCalledTimes(1);
    expect(harness.counters.snapshot()).toMatchObject({ hits: 1, misses: 1, writes: 1, liveCalls: 1 });
  });

  it('goes live on refresh and stores the newer answer', async () => {
    await harness.executor.execute(request(ok([{ id: 'old' }])));
    const live = ok([{ id: 'new' }]);

    const refreshed = await harness.executor.execute(request(live, { directive: { policy: 'refresh', allowFallback: true } }));
    const cached = await harness.executor.execute(request(ok([])));

    expect(refreshed.source).toBe('live');
    expect(live).toHaveBeenCalledTimes(1);
    expect(cached).toMatchObject({ source: 'cache', value: [{ id: 'new' }] });
  });

  it('never calls the provider under only-if-cached', async () => {
    const live = ok([{ id: 'a' }]);

    const result = await harness.executor.execute(request(live, { directive: { policy: 'only-if-cached', allowFallback: false } }));

    expect(result).toEqual({ source: 'none', liveOutcome: 'skipped', outboundRequests: 0 });
    expect(live).not.toHaveBeenCalled();
  });

  it('neither reads nor writes for an unavailable provider, but still calls it', async () => {
    await harness.executor.execute(request(ok([{ id: 'a' }])));
    const live = vi.fn(() => Promise.resolve([] as Item[]));

    const result = await harness.executor.execute(request(live, { context: { available: false, fingerprint: '{}' } }));

    expect(live).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: 'live', value: [] });
  });

  it.each([
    ['no_upstream', () => Promise.resolve([{ id: 'a' }])],
    [
      'request_failed',
      () => {
        recordProviderRequest('GET https://example.test/detail', { kind: 'status', status: 500 });
        return Promise.resolve([{ id: 'a' }]);
      },
    ],
    [
      'request_failed',
      () => {
        recordProviderRequest('GET https://example.test/detail', { kind: 'error', errorClass: 'TypeError' });
        return Promise.resolve([{ id: 'a' }]);
      },
    ],
    [
      'provider_failed',
      () => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        markProviderFailed('malformed json');
        return Promise.resolve([]);
      },
    ],
    [
      'degraded',
      () => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        markProviderDegraded('challenge');
        return Promise.resolve([{ id: 'a' }]);
      },
    ],
    [
      'truncated',
      () => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        markProviderTruncated();
        return Promise.resolve([{ id: 'a' }]);
      },
    ],
    [
      'untrusted_empty',
      () => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        return Promise.resolve([]);
      },
    ],
  ] as const)('does not store an answer that is %s', async (reason, live) => {
    const result = await harness.executor.execute(request(vi.fn(live)));

    expect(result.source).toBe('live');
    expect(result.uncacheableReason).toBe(reason);
    expect(harness.repository.rows.size).toBe(0);
  });

  it('stores an empty answer only for a provider that reports failures reliably', async () => {
    const live = ok([]);
    await harness.executor.execute(request(live, { spec: makeSpec({ trustEmpty: true }) }));
    const second = await harness.executor.execute(request(live, { spec: makeSpec({ trustEmpty: true }) }));

    expect(second).toMatchObject({ source: 'cache', value: [] });
    expect([...harness.repository.rows.values()][0].status).toBe('empty');
  });

  it('keeps no empty answers when the empty-results TTL is zero', async () => {
    harness.setConfig({ emptyTtlSeconds: 0 });
    const result = await harness.executor.execute(request(ok([]), { spec: makeSpec({ trustEmpty: true }) }));

    expect(result.uncacheableReason).toBe('empty_not_kept');
  });

  it('treats a retried request that finally succeeds as complete', async () => {
    const live = vi.fn(() => {
      recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 503 });
      recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
      return Promise.resolve([{ id: 'a' }]);
    });

    await harness.executor.execute(request(live));

    expect(harness.repository.rows.size).toBe(1);
  });

  it('reports a throttle with its retry hint and serves the stored answer as a fallback', async () => {
    await harness.executor.execute(request(ok([{ id: 'stored' }])));

    const result = await harness.executor.execute(
      request(() => Promise.reject(new Error('throttled')), { directive: { policy: 'refresh', allowFallback: true } }),
    );

    expect(result).toMatchObject({ source: 'fallback', liveOutcome: 'throttled', retryAfterSeconds: 60, value: [{ id: 'stored' }], stale: false });
    expect(result.partial).toEqual([{ id: 'p' }]);
  });

  it('serves nothing on failure when fallback is not allowed', async () => {
    await harness.executor.execute(request(ok([{ id: 'stored' }])));

    const result = await harness.executor.execute(
      request(() => Promise.reject(new Error('boom')), { directive: { policy: 'refresh', allowFallback: false } }),
    );

    expect(result).toMatchObject({ source: 'none', liveOutcome: 'failed' });
    expect(result.value).toBeUndefined();
  });

  it('abandons a live call at the caller deadline and falls back', async () => {
    await harness.executor.execute(request(ok([{ id: 'stored' }])));
    const controller = new AbortController();
    let liveSignal: AbortSignal | undefined;
    const hanging = vi.fn((signal: AbortSignal) => {
      liveSignal = signal;
      return new Promise<Item[]>(() => undefined);
    });

    const pending = harness.executor.execute(request(hanging, { directive: { policy: 'refresh', allowFallback: true }, signal: controller.signal }));
    await vi.waitFor(() => expect(hanging).toHaveBeenCalled());
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ source: 'fallback', liveOutcome: 'timeout', value: [{ id: 'stored' }] });
    expect(liveSignal?.aborted).toBe(true);
  });

  it('shares one live call between concurrent identical requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = vi.fn(async () => {
      recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
      await gate;
      return [{ id: 'a' }];
    });

    const first = harness.executor.execute(request(live));
    const second = harness.executor.execute(request(live));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const results = await Promise.all([first, second]);

    expect(live).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.value)).toEqual([[{ id: 'a' }], [{ id: 'a' }]]);
  });

  it('keeps a shared live call running while another caller still waits for it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let liveSignal: AbortSignal | undefined;
    const live = vi.fn(async (signal: AbortSignal) => {
      liveSignal = signal;
      recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
      await gate;
      return [{ id: 'a' }];
    });
    const impatient = new AbortController();

    const leaving = harness.executor.execute(request(live, { signal: impatient.signal }));
    const staying = harness.executor.execute(request(live));
    await new Promise((resolve) => setTimeout(resolve, 0));
    impatient.abort();
    expect((await leaving).liveOutcome).toBe('timeout');
    expect(liveSignal?.aborted).toBe(false);
    release();

    expect(await staying).toMatchObject({ source: 'live', value: [{ id: 'a' }] });
  });

  it('does not store what a cancelled call returned after every caller left', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = vi.fn(async () => {
      recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
      await gate;
      return [{ id: 'partial' }];
    });
    const caller = new AbortController();

    const pending = harness.executor.execute(request(live, { signal: caller.signal }));
    await vi.waitFor(() => expect(live).toHaveBeenCalled());
    caller.abort();
    await pending;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.repository.rows.size).toBe(0);
    expect(harness.counters.snapshot().uncacheable.aborted).toBe(1);
  });

  it('serves a stored "not found" lookup instead of discarding it', async () => {
    const lookupCodec: CacheCodec<Item | null> = {
      isEmpty: (value) => value === null,
      sanitize: (value) => value,
      parse: (payload) => (payload === null ? null : typeof (payload as Item)?.id === 'string' ? (payload as Item) : undefined),
      slice: (value) => value,
      publishedDates: () => [],
    };
    const live = vi.fn(() => {
      recordProviderRequest('GET https://example.test/item/1', { kind: 'status', status: 404 });
      return Promise.resolve(null);
    });
    const lookup: ProviderOperationRequest<Item | null> = {
      namespace: 'book',
      provider: 'google',
      operation: 'lookup',
      spec: makeSpec({ trustEmpty: true, authoritativeLookupStatuses: [404] }),
      descriptor: { inputs: { id: '1' } },
      directive: DEFAULT,
      codec: lookupCodec,
      live,
      classifyError: () => ({ outcome: 'failed' }),
    };

    await harness.executor.execute(lookup);
    const second = await harness.executor.execute(lookup);

    expect(live).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ source: 'cache', value: null });
    expect([...harness.repository.rows.values()][0].status).toBe('not_found');
  });

  describe('result caps', () => {
    const capped = (max: number | null): CacheKeyDescriptor => ({ inputs: { title: 'Dune' }, maxCandidates: max });

    it('serves a smaller request from a larger stored answer', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }, { id: 'b' }]), {}, capped(null)));

      const result = await harness.executor.execute(request(ok([]), {}, capped(1)));

      expect(result).toMatchObject({ source: 'cache', value: [{ id: 'a' }] });
    });

    it('goes live when the stored answer holds fewer results than requested', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }]), {}, capped(1)));
      const live = ok([{ id: 'a' }, { id: 'b' }]);

      const result = await harness.executor.execute(request(live, {}, capped(null)));

      expect(live).toHaveBeenCalledTimes(1);
      expect(result.value).toHaveLength(2);
    });

    it('falls back to a smaller stored answer when the provider fails', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }]), {}, capped(1)));

      const result = await harness.executor.execute(request(() => Promise.reject(new Error('boom')), {}, capped(null)));

      expect(result).toMatchObject({ source: 'fallback', value: [{ id: 'a' }] });
    });
  });

  describe('cover validation', () => {
    const validated: CacheKeyDescriptor = { inputs: { title: 'Dune' }, coverValidation: true };

    it('does not mark an answer validated when a cover check was indefinite', async () => {
      const live = vi.fn(() => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        recordAuxiliaryProviderRequest(false);
        return Promise.resolve([{ id: 'a' }]);
      });
      await harness.executor.execute(request(live, {}, validated));
      const again = ok([{ id: 'a' }]);

      await harness.executor.execute(request(again, {}, validated));

      expect(again).toHaveBeenCalledTimes(1);
    });

    it('serves an unvalidated request from a validated answer', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }]), {}, validated));

      const result = await harness.executor.execute(request(ok([]), {}, { inputs: { title: 'Dune' }, coverValidation: false }));

      expect(result.source).toBe('cache');
    });
  });

  describe('freshness', () => {
    it('applies a shortened TTL to answers already stored', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await harness.executor.execute(request(ok([{ id: 'a' }])));
      vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
      harness.setConfig({ resultsTtlSeconds: 60 * 60, staleGraceSeconds: 0 });
      const live = ok([{ id: 'b' }]);

      const result = await harness.executor.execute(request(live));

      expect(live).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('live');
    });

    it('serves an answer past its TTL only as a fallback within the grace period', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await harness.executor.execute(request(ok([{ id: 'a' }])));
      vi.setSystemTime(new Date(Date.now() + 10 * DAY));

      const result = await harness.executor.execute(request(() => Promise.reject(new Error('boom'))));

      expect(result).toMatchObject({ source: 'fallback', stale: true, value: [{ id: 'a' }] });
    });

    it('keeps new releases for a shorter time', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await harness.executor.execute(request(ok([{ id: 'a', publishedDate: '2026-02-01' }])));
      vi.setSystemTime(new Date(Date.now() + 4 * DAY));
      const live = ok([{ id: 'a' }]);

      await harness.executor.execute(request(live));

      expect(live).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearing', () => {
    it('ignores answers fetched before a clear marker', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }])));
      harness.setMarkers([{ provider: 'google', at: new Date(Date.now() + 1000).toISOString() }]);
      const live = ok([{ id: 'b' }]);

      await harness.executor.execute(request(live));

      expect(live).toHaveBeenCalledTimes(1);
    });

    it('discards a write from a call that started before a clear', async () => {
      const live = vi.fn(() => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        harness.setMarkers([{ at: new Date(Date.now() + 1000).toISOString() }]);
        return Promise.resolve([{ id: 'a' }]);
      });

      await harness.executor.execute(request(live));

      expect(harness.repository.rows.size).toBe(0);
    });
  });

  describe('failing open', () => {
    it('goes live when the cache cannot be read', async () => {
      harness.repository.failReads = true;
      const live = ok([{ id: 'a' }]);

      const result = await harness.executor.execute(request(live));

      expect(result).toMatchObject({ source: 'live', value: [{ id: 'a' }] });
      expect(harness.counters.snapshot().readFailures).toBeGreaterThan(0);
    });

    it('returns the live answer when the write fails', async () => {
      harness.repository.failWrites = true;

      const result = await harness.executor.execute(request(ok([{ id: 'a' }])));

      expect(result.value).toEqual([{ id: 'a' }]);
      expect(harness.counters.snapshot().writeFailures).toBe(1);
    });

    it('treats an unreadable stored payload as a miss and removes it', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }])));
      const [key, row] = [...harness.repository.rows.entries()][0];
      harness.repository.rows.set(key, { ...row, payload: '{"not":"an array"}' });
      const live = ok([{ id: 'b' }]);

      await harness.executor.execute(request(live));

      expect(live).toHaveBeenCalledTimes(1);
    });

    it('skips writes and asks for a sweep when the storage budget is used up', async () => {
      harness.setConfig({ maxStorageMb: 50 });
      harness.budget.set(51 * 1024 * 1024);

      await harness.executor.execute(request(ok([{ id: 'a' }])));

      expect(harness.repository.rows.size).toBe(0);
      expect(harness.sweeper.requests).toContain('budget');
    });

    it('does not store an answer over the per-entry size cap', async () => {
      const result = await harness.executor.execute(request(ok([{ id: 'x'.repeat(600 * 1024) }])));

      expect(result.uncacheableReason).toBe('too_large');
    });

    it('does not store an answer that would not read back, and still returns it', async () => {
      const result = await harness.executor.execute(request(ok([{ id: 5 as unknown as string }])));

      expect(result).toMatchObject({ source: 'live', value: [{ id: 5 }], uncacheableReason: 'invalid_payload' });
      expect(harness.repository.rows.size).toBe(0);
    });

    it('removes a stored entry that cannot be judged instead of failing every read of it', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }])));
      const throwingCodec: CacheCodec<Item[]> = {
        ...codec,
        publishedDates: () => {
          throw new TypeError('bad date');
        },
      };
      const live = ok([{ id: 'b' }]);

      const result = await harness.executor.execute(request(live, { codec: throwingCodec }));

      expect(live).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ source: 'live', value: [{ id: 'b' }] });
    });
  });

  describe('storage accounting', () => {
    const REFRESH: CacheDirective = { policy: 'refresh', allowFallback: true };

    it('counts only the bytes a replacement adds', async () => {
      await harness.executor.execute(request(ok([{ id: 'a' }]), { directive: REFRESH }));
      const afterFirst = harness.budget.bytes;
      await harness.executor.execute(request(ok([{ id: 'a' }]), { directive: REFRESH }));
      await harness.executor.execute(request(ok([{ id: 'abc' }]), { directive: REFRESH }));

      expect(afterFirst).toBe([...harness.repository.rows.values()][0].payloadBytes - 2);
      expect(harness.budget.bytes).toBe([...harness.repository.rows.values()][0].payloadBytes);
    });
  });

  it('never calls a provider for a cache-only request when caching is off', async () => {
    harness.setConfig({ enabled: false });
    const live = ok([{ id: 'a' }]);

    const result = await harness.executor.execute(request(live, { directive: { policy: 'only-if-cached', allowFallback: false } }));

    expect(live).not.toHaveBeenCalled();
    expect(result).toEqual({ source: 'none', liveOutcome: 'skipped', outboundRequests: 0 });
  });

  it('never calls a provider for a cache-only request when it has no cache spec', async () => {
    const live = ok([{ id: 'a' }]);

    const result = await harness.executor.execute(request(live, { spec: undefined, directive: { policy: 'only-if-cached', allowFallback: false } }));

    expect(live).not.toHaveBeenCalled();
    expect(result.liveOutcome).toBe('skipped');
  });

  it('returns the live answer when the deadline passes while it is being stored', async () => {
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writing = false;
    const upsert = harness.repository.upsert.bind(harness.repository);
    harness.repository.upsert = async (row) => {
      writing = true;
      await writeGate;
      return upsert(row);
    };
    const deadline = new AbortController();

    const pending = harness.executor.execute(request(ok([{ id: 'live' }]), { signal: deadline.signal }));
    await vi.waitFor(() => expect(writing).toBe(true));
    deadline.abort();
    const result = await pending;
    releaseWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toMatchObject({ source: 'live', liveOutcome: 'ok', value: [{ id: 'live' }] });
    expect(harness.repository.rows.size).toBe(1);
  });

  describe('a provider that answers despite a failed request', () => {
    const REFRESH: CacheDirective = { policy: 'refresh', allowFallback: true };

    function swallowedFailure(mark: 'status' | 'reported' = 'status') {
      return vi.fn(() => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: mark === 'status' ? 503 : 200 });
        if (mark === 'reported') markProviderFailed('error inside a 200 body');
        return Promise.resolve([] as Item[]);
      });
    }

    it('falls back to the saved answer for a failed request', async () => {
      await harness.executor.execute(request(ok([{ id: 'saved' }])));

      const result = await harness.executor.execute(request(swallowedFailure(), { directive: REFRESH }));

      expect(result).toMatchObject({ source: 'fallback', liveOutcome: 'failed', stale: false, value: [{ id: 'saved' }] });
      expect(harness.counters.snapshot().fallbacks).toBe(1);
    });

    it('falls back to the saved answer for a failure the provider reported', async () => {
      await harness.executor.execute(request(ok([{ id: 'saved' }])));

      const result = await harness.executor.execute(request(swallowedFailure('reported'), { directive: REFRESH }));

      expect(result).toMatchObject({ source: 'fallback', liveOutcome: 'failed', value: [{ id: 'saved' }] });
    });

    it('uses an expired answer within the grace period on a default search', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await harness.executor.execute(request(ok([{ id: 'saved' }])));
      vi.setSystemTime(new Date(Date.now() + 10 * DAY));

      const result = await harness.executor.execute(request(swallowedFailure()));

      expect(result).toMatchObject({ source: 'fallback', liveOutcome: 'failed', stale: true, value: [{ id: 'saved' }] });
    });

    it('keeps the live answer when nothing is saved', async () => {
      const result = await harness.executor.execute(request(swallowedFailure(), { directive: REFRESH }));

      expect(result).toMatchObject({ source: 'live', liveOutcome: 'ok', value: [] });
    });

    it('keeps the live answer when fallback is not allowed', async () => {
      await harness.executor.execute(request(ok([{ id: 'saved' }])));

      const result = await harness.executor.execute(request(swallowedFailure(), { directive: { policy: 'refresh', allowFallback: false } }));

      expect(result).toMatchObject({ source: 'live', liveOutcome: 'ok', value: [] });
    });
  });

  it('does not cache at all when the cache is disabled', async () => {
    harness.setConfig({ enabled: false });
    const live = ok([{ id: 'a' }]);

    await harness.executor.execute(request(live));
    await harness.executor.execute(request(live));

    expect(live).toHaveBeenCalledTimes(2);
    expect(harness.repository.rows.size).toBe(0);
  });

  it('honours a per-provider switch-off', async () => {
    harness.setConfig({ providerOverrides: [{ namespace: 'book', provider: 'google', enabled: false }] });
    const live = ok([{ id: 'a' }]);

    await harness.executor.execute(request(live));
    await harness.executor.execute(request(live));

    expect(live).toHaveBeenCalledTimes(2);
  });

  it('keeps entries of different providers and namespaces apart', async () => {
    await harness.executor.execute(request(ok([{ id: 'book' }])));
    const live = ok([{ id: 'author' }]);

    const result = await harness.executor.execute(request(live, { namespace: 'author' }));

    expect(live).toHaveBeenCalledTimes(1);
    expect(result.value).toEqual([{ id: 'author' }]);
  });
});
