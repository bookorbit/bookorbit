import { DEFAULT_METADATA_CACHE_CONFIG } from '@bookorbit/types';
import { firstValueFrom, toArray } from 'rxjs';

import type { ProviderCacheSpec } from '../../../common/provider-cache/provider-cache-spec';
import { MetadataCacheAccessTracker, MetadataCacheBudget, MetadataCacheCounterService } from '../../metadata-cache/metadata-cache-state';
import {
  ProviderOperationExecutor,
  type ProviderOperationRequest,
  type ProviderOperationResult,
} from '../../metadata-cache/provider-operation-executor.service';
import { classifyAuthorProviderError } from './author-provider-run';
import { AuthorMetadataFetchService } from './author-metadata-fetch.service';
import { AudnexusAuthorMetadataProvider } from './providers/audnexus/audnexus.provider';
import { AuthorMetadataProviderError, type AuthorMetadataSearchParams } from './providers/author-metadata-provider';
import { authorProviderCacheContext } from './providers/author-provider-cache';

type AnyRequest = ProviderOperationRequest<unknown>;

/** Behaves like the executor with caching disabled: runs the live call and classifies its failure. */
function passThroughExecutor() {
  const execute = vi.fn(async (request: AnyRequest): Promise<ProviderOperationResult<unknown>> => {
    try {
      const value = await request.live(request.signal ?? new AbortController().signal);
      return { value, source: 'live', liveOutcome: 'ok', outboundRequests: 1 };
    } catch (error) {
      const failure = request.classifyError(error);
      return { source: 'none', liveOutcome: failure.outcome, error, retryAfterSeconds: failure.retryAfterSeconds, outboundRequests: 1 };
    }
  });
  const resolveContext = vi.fn(async (spec?: ProviderCacheSpec<unknown>) => (spec ? spec.context() : null));
  return { execute, resolveContext };
}

function cacheSpec(overrides?: Partial<ProviderCacheSpec<AuthorMetadataSearchParams>>): ProviderCacheSpec<AuthorMetadataSearchParams> {
  return {
    version: 1,
    trustEmpty: false,
    context: () => Promise.resolve(authorProviderCacheContext(true)),
    describeSearch: (params) => ({ inputs: { name: params.name, region: params.region } }),
    describeLookup: (id, params) => ({ inputs: { id, region: params?.region } }),
    ...overrides,
  };
}

describe('AuthorMetadataFetchService', () => {
  const registry = {
    all: vi.fn(),
    select: vi.fn(),
    find: vi.fn(),
  };

  let executor: ReturnType<typeof passThroughExecutor>;
  let service: AuthorMetadataFetchService;

  beforeEach(() => {
    vi.resetAllMocks();
    executor = passThroughExecutor();
    service = new AuthorMetadataFetchService(registry as never, executor as never);
  });

  it('listProviders maps registry providers for client display', () => {
    registry.all.mockReturnValue([
      { key: 'audnexus', label: 'Audnexus', identifiable: true, supportedFields: ['description', 'photo'] },
      { key: 'other', label: 'Other', identifiable: false, supportedFields: [] },
    ]);

    // supportedFields tells the settings UI which fields a provider may be
    // assigned to at all.
    expect(service.listProviders()).toEqual([
      { key: 'audnexus', label: 'Audnexus', identifiable: true, supportedFields: ['description', 'photo'] },
      { key: 'other', label: 'Other', identifiable: false, supportedFields: [] },
    ]);
  });

  it('quickSearchDetailed returns candidate when provider succeeds', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: false,
      search: vi.fn().mockResolvedValue([
        {
          provider: 'audnexus',
          providerId: 'A2',
          name: 'Author One',
        },
      ]),
    };
    registry.select.mockReturnValue([provider]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toEqual({
      candidate: {
        provider: 'audnexus',
        providerId: 'A2',
        name: 'Author One',
      },
      failure: null,
      cacheServed: [],
      outboundRequests: 1,
    });
    expect(provider.search).toHaveBeenCalledWith({
      name: 'Author One',
      region: 'us',
      limit: 8,
      signal: expect.any(AbortSignal),
    });
  });

  it('quickSearchDetailed exposes provider failure metadata for retry handling', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockRejectedValue(
          new AuthorMetadataProviderError('429 too many requests', {
            httpStatus: 429,
            retryAfterMs: 20_000,
            transient: true,
          }),
        ),
      },
    ]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toMatchObject({
      candidate: null,
      failure: {
        provider: 'audnexus',
        message: '429 too many requests',
        httpStatus: 429,
        retryAfterMs: 20_000,
        transient: true,
      },
    });
  });

  it('quickSearchDetailed returns no match for low-confidence candidates', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'audnexus', providerId: 'A1', name: 'Charles Lewis' },
          { provider: 'audnexus', providerId: 'A2', name: 'Charles Pellegrino' },
        ]),
      },
    ]);

    await expect(service.quickSearchDetailed({ name: 'Charles Exbrayat' })).resolves.toMatchObject({
      candidate: null,
      failure: null,
    });
  });

  it('quickSearchDetailed ranks candidates and selects the best acceptable match', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'audnexus', providerId: 'A1', name: 'George Oswell' },
          { provider: 'audnexus', providerId: 'A2', name: 'George Orwell' },
        ]),
      },
    ]);

    await expect(service.quickSearchDetailed({ name: 'George Orwell' })).resolves.toMatchObject({
      candidate: { provider: 'audnexus', providerId: 'A2', name: 'George Orwell' },
      failure: null,
    });
  });

  it('search returns empty when no providers match the filter', async () => {
    registry.select.mockReturnValue([]);

    await expect(service.search({ name: 'Nobody' }, { keys: ['audnexus'] })).resolves.toEqual([]);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('search clamps limit and tolerates provider failures by returning successful batches', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]),
      },
      {
        key: 'other',
        label: 'Other',
        identifiable: false,
        search: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      },
    ]);

    await expect(service.search({ name: 'Author One', limit: 0 })).resolves.toEqual([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]);
  });

  it('stream enforces global result limit across providers', async () => {
    registry.select.mockReturnValue([
      {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'audnexus', providerId: 'A1', name: 'Author One' },
          { provider: 'audnexus', providerId: 'A2', name: 'Author Two' },
        ]),
      },
      {
        key: 'other',
        label: 'Other',
        identifiable: false,
        search: vi.fn().mockResolvedValue([
          { provider: 'other', providerId: 'B1', name: 'Author Three' },
          { provider: 'other', providerId: 'B2', name: 'Author Four' },
        ]),
      },
    ]);

    const emitted = await firstValueFrom(service.stream({ name: 'author', limit: 2 }).pipe(toArray()));
    expect(emitted).toHaveLength(2);
  });

  it('quickSearchDetailed returns provider failure when identifiable lookup fails', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'Author One' }]),
      lookupById: vi.fn().mockRejectedValue(new Error('lookup failed')),
    };
    registry.select.mockReturnValue([provider]);

    await expect(service.quickSearchDetailed({ name: 'Author One' })).resolves.toEqual({
      candidate: null,
      failure: {
        provider: 'audnexus',
        message: 'lookup failed',
        httpStatus: null,
        retryAfterMs: null,
        transient: true,
      },
      cacheServed: [],
      outboundRequests: 2,
    });
  });

  it('quickSearchDetailed rejects detail payloads that fail confidence gates', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'George Orwell' }]),
      lookupById: vi.fn().mockResolvedValue({ provider: 'audnexus', providerId: 'A1', name: 'Who Is George Orwell?' }),
    };
    registry.select.mockReturnValue([provider]);

    await expect(service.quickSearchDetailed({ name: 'George Orwell' })).resolves.toMatchObject({
      candidate: null,
      failure: null,
    });
  });

  it('lookupById returns null when provider is missing or not identifiable', async () => {
    registry.find.mockReturnValueOnce(undefined).mockReturnValueOnce({
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: false,
      search: vi.fn(),
    });

    await expect(service.lookupById('audnexus', 'x1')).resolves.toBeNull();
    await expect(service.lookupById('audnexus', 'x2')).resolves.toBeNull();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('lookupById delegates to identifiable provider', async () => {
    const provider = {
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn(),
      lookupById: vi.fn().mockResolvedValue({ provider: 'audnexus', providerId: '42', name: 'Douglas Adams' }),
    };
    registry.find.mockReturnValue(provider);

    await expect(service.lookupById('audnexus', '42', 'us')).resolves.toEqual({
      provider: 'audnexus',
      providerId: '42',
      name: 'Douglas Adams',
    });
    expect(provider.lookupById).toHaveBeenCalledWith('42', 'us', expect.any(AbortSignal));
  });

  it('lookupById swallows provider failures as today', async () => {
    registry.find.mockReturnValue({
      key: 'audnexus',
      label: 'Audnexus',
      identifiable: true,
      search: vi.fn(),
      lookupById: vi.fn().mockRejectedValue(new AuthorMetadataProviderError('boom', { transient: true })),
    });

    await expect(service.lookupById('audnexus', '42')).resolves.toBeNull();
  });

  describe('cache integration', () => {
    function cachedProvider(spec = cacheSpec()) {
      return {
        key: 'audnexus',
        label: 'Audnexus',
        identifiable: true,
        cache: spec,
        search: vi.fn().mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' }]),
        lookupById: vi.fn().mockResolvedValue({ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe', description: 'Bio' }),
      };
    }

    it('passes the default directive, the resolved context and the provider spec to the executor', async () => {
      const provider = cachedProvider();
      registry.select.mockReturnValue([provider]);

      await service.search({ name: 'Jane Doe' });

      expect(executor.resolveContext).toHaveBeenCalledTimes(1);
      expect(executor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'author',
          provider: 'audnexus',
          operation: 'search',
          spec: provider.cache,
          context: authorProviderCacheContext(true),
          directive: { policy: 'default', allowFallback: true },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('passes the caller directive through every operation of a run', async () => {
      const provider = cachedProvider();
      registry.select.mockReturnValue([provider]);
      const directive = { policy: 'refresh', allowFallback: false } as const;

      await service.quickSearchDetailed({ name: 'Jane Doe' }, { directive });

      const operations = executor.execute.mock.calls.map(([request]) => [request.operation, request.directive]);
      expect(operations).toEqual([
        ['search', directive],
        ['lookup', directive],
      ]);
      expect(executor.resolveContext).toHaveBeenCalledTimes(1);
    });

    it('canonicalizes the name and region for both the key and the provider call', async () => {
      const provider = cachedProvider();
      registry.select.mockReturnValue([provider]);

      await service.search({ name: '  Jane \n Doe ', region: ' CA ' });

      const [request] = executor.execute.mock.calls[0]!;
      expect(request.descriptor).toEqual({ inputs: { name: 'Jane Doe', region: 'ca' } });
      expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe', region: 'ca' }));
    });

    it('attaches cache provenance to candidates the cache answered', async () => {
      const provider = cachedProvider();
      registry.select.mockReturnValue([provider]);
      executor.execute.mockResolvedValueOnce({
        value: [{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' }],
        source: 'cache',
        cachedAt: '2026-09-01T00:00:00.000Z',
        stale: false,
        liveOutcome: 'ok',
        outboundRequests: 0,
      });

      await expect(service.searchDetailed({ name: 'Jane Doe' })).resolves.toEqual({
        candidates: [{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe', cache: { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false } }],
        cacheServed: [{ provider: 'audnexus', source: 'cache', stale: false, cachedAt: '2026-09-01T00:00:00.000Z' }],
        outboundRequests: 0,
      });
      expect(provider.search).not.toHaveBeenCalled();
    });

    it('leaves live candidates without a cache marker', async () => {
      registry.select.mockReturnValue([cachedProvider()]);

      const [candidate] = await service.search({ name: 'Jane Doe' });

      expect(candidate).not.toHaveProperty('cache');
    });

    it('streams cache provenance with each candidate', async () => {
      registry.select.mockReturnValue([cachedProvider()]);
      executor.execute.mockResolvedValueOnce({
        value: [{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' }],
        source: 'fallback',
        cachedAt: '2026-08-01T00:00:00.000Z',
        stale: true,
        liveOutcome: 'failed',
        outboundRequests: 1,
      });

      const emitted = await firstValueFrom(service.stream({ name: 'Jane Doe' }).pipe(toArray()));

      expect(emitted).toEqual([
        { provider: 'audnexus', providerId: 'A1', name: 'Jane Doe', cache: { fetchedAt: '2026-08-01T00:00:00.000Z', stale: true } },
      ]);
    });

    it('attaches cache provenance to a cached lookup', async () => {
      registry.find.mockReturnValue(cachedProvider());
      executor.execute.mockResolvedValueOnce({
        value: { provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' },
        source: 'cache',
        cachedAt: '2026-09-01T00:00:00.000Z',
        stale: false,
        liveOutcome: 'ok',
        outboundRequests: 0,
      });

      await expect(service.lookupById('audnexus', ' A1 ', 'CA', { directive: { policy: 'default', allowFallback: true } })).resolves.toEqual({
        provider: 'audnexus',
        providerId: 'A1',
        name: 'Jane Doe',
        cache: { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false },
      });
      const [request] = executor.execute.mock.calls[0]!;
      expect(request.descriptor).toEqual({ inputs: { id: 'A1', region: 'ca' } });
    });

    it('counts a fallback-served provider as a success and reports it', async () => {
      registry.select.mockReturnValue([cachedProvider()]);
      executor.execute
        .mockResolvedValueOnce({
          value: [{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' }],
          source: 'fallback',
          cachedAt: '2026-08-02T00:00:00.000Z',
          stale: false,
          liveOutcome: 'throttled',
          error: new AuthorMetadataProviderError('429', { httpStatus: 429, transient: true }),
          outboundRequests: 1,
        })
        .mockResolvedValueOnce({
          value: { provider: 'audnexus', providerId: 'A1', name: 'Jane Doe', description: 'Bio' },
          source: 'fallback',
          cachedAt: '2026-08-01T00:00:00.000Z',
          stale: true,
          liveOutcome: 'failed',
          error: new Error('down'),
          outboundRequests: 1,
        });

      const result = await service.quickSearchDetailed({ name: 'Jane Doe' }, { directive: { policy: 'refresh', allowFallback: true } });

      expect(result).toEqual({
        candidate: { provider: 'audnexus', providerId: 'A1', name: 'Jane Doe', description: 'Bio' },
        failure: null,
        cacheServed: [{ provider: 'audnexus', source: 'fallback', stale: true, cachedAt: '2026-08-01T00:00:00.000Z' }],
        outboundRequests: 2,
      });
    });

    it('collectByProvider aggregates provenance and outbound requests across providers', async () => {
      const audnexus = cachedProvider();
      const goodreads = { ...cachedProvider(), key: 'goodreads', label: 'Goodreads' };
      registry.find.mockImplementation((key: string) => (key === 'audnexus' ? audnexus : goodreads));
      registry.select.mockImplementation((keys: string[]) => (keys[0] === 'audnexus' ? [audnexus] : [goodreads]));
      executor.execute
        .mockResolvedValueOnce({
          value: [{ provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' }],
          source: 'cache',
          cachedAt: '2026-09-01T00:00:00.000Z',
          stale: false,
          liveOutcome: 'ok',
          outboundRequests: 0,
        })
        .mockResolvedValueOnce({
          value: { provider: 'audnexus', providerId: 'A1', name: 'Jane Doe' },
          source: 'cache',
          cachedAt: '2026-09-02T00:00:00.000Z',
          stale: false,
          liveOutcome: 'ok',
          outboundRequests: 0,
        })
        .mockResolvedValueOnce({
          value: [{ provider: 'goodreads', providerId: 'G1', name: 'Jane Doe' }],
          source: 'live',
          liveOutcome: 'ok',
          outboundRequests: 2,
        })
        .mockResolvedValueOnce({
          value: { provider: 'goodreads', providerId: 'G1', name: 'Jane Doe' },
          source: 'live',
          liveOutcome: 'ok',
          outboundRequests: 1,
        });

      const result = await service.collectByProvider({ name: 'Jane Doe' }, ['audnexus', 'goodreads'] as never, {
        policy: 'default',
        allowFallback: true,
      });

      expect([...result.candidates.keys()]).toEqual(['audnexus', 'goodreads']);
      expect(result.failures).toEqual([]);
      expect(result.cacheServed).toEqual([{ provider: 'audnexus', source: 'cache', stale: false, cachedAt: '2026-09-01T00:00:00.000Z' }]);
      expect(result.outboundRequests).toBe(3);
      expect(executor.execute.mock.calls.every(([request]) => request.directive.policy === 'default')).toBe(true);
    });

    it('reports a timeout from the executor as the transient provider timeout', async () => {
      const provider = cachedProvider();
      provider.search.mockReturnValue(new Promise(() => undefined));
      registry.select.mockReturnValue([provider]);
      executor.execute.mockResolvedValueOnce({ source: 'none', liveOutcome: 'timeout', outboundRequests: 1 });

      await expect(service.quickSearchDetailed({ name: 'Jane Doe' })).resolves.toMatchObject({
        candidate: null,
        failure: { provider: 'audnexus', message: 'Author metadata provider timeout', transient: true },
      });
    });

    it('leaves the operation deadline to the executor instead of racing its own timer', async () => {
      registry.select.mockReturnValue([cachedProvider()]);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await service.quickSearchDetailed({ name: 'Jane Doe' });

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      const signals = executor.execute.mock.calls.map(([request]) => request.signal);
      expect(signals).toHaveLength(2);
      expect(signals[0]).not.toBe(signals[1]);
      setTimeoutSpy.mockRestore();
    });
  });

  describe('classifyAuthorProviderError', () => {
    it('treats a 429 or a retry-after as throttled', () => {
      expect(classifyAuthorProviderError(new AuthorMetadataProviderError('rate', { httpStatus: 429 }))).toEqual({
        outcome: 'throttled',
        retryAfterSeconds: undefined,
      });
      expect(classifyAuthorProviderError(new AuthorMetadataProviderError('busy', { httpStatus: 503, retryAfterMs: 1_500 }))).toEqual({
        outcome: 'throttled',
        retryAfterSeconds: 2,
      });
    });

    it('treats everything else as failed', () => {
      expect(classifyAuthorProviderError(new AuthorMetadataProviderError('down', { httpStatus: 503, transient: true }))).toEqual({
        outcome: 'failed',
      });
      expect(classifyAuthorProviderError(new Error('boom'))).toEqual({ outcome: 'failed' });
      expect(classifyAuthorProviderError('weird')).toEqual({ outcome: 'failed' });
    });
  });

  describe('with the real executor', () => {
    const originalFetch = global.fetch;

    function jsonResponse(body: unknown, status = 200) {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: vi.fn().mockReturnValue(null) },
        json: vi.fn().mockResolvedValue(body),
      };
    }

    function realExecutor() {
      const rows = new Map<string, Record<string, unknown>>();
      const repository = {
        find: vi.fn((key: string) => Promise.resolve(rows.get(key) ?? null)),
        upsert: vi.fn((row: Record<string, unknown>) => {
          rows.set(row.keyHash as string, { id: rows.size + 1, ...row });
          return Promise.resolve(row.payloadBytes as number);
        }),
        delete: vi.fn((key: string) => {
          rows.delete(key);
          return Promise.resolve();
        }),
      };
      const config = { snapshot: vi.fn().mockResolvedValue({ config: DEFAULT_METADATA_CACHE_CONFIG, markers: [] }) };
      const instance = new ProviderOperationExecutor(
        config as never,
        repository as never,
        new MetadataCacheCounterService(),
        new MetadataCacheBudget(),
        new MetadataCacheAccessTracker(),
        { requestSweep: vi.fn() } as never,
      );
      return { instance, rows };
    }

    let audnexus: AudnexusAuthorMetadataProvider;

    beforeEach(() => {
      audnexus = new AudnexusAuthorMetadataProvider();
      registry.select.mockReturnValue([audnexus]);
      registry.find.mockReturnValue(audnexus);
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('answers a repeated search from the cache without going out', async () => {
      const { instance, rows } = realExecutor();
      service = new AuthorMetadataFetchService(registry as never, instance);
      global.fetch = vi.fn().mockResolvedValue(jsonResponse([{ asin: 'B1', name: 'Jane Doe' }])) as never;

      const first = await service.searchDetailed({ name: 'Jane Doe' });
      const second = await service.searchDetailed({ name: '  Jane   Doe ' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(rows.size).toBe(1);
      expect(first.outboundRequests).toBe(1);
      expect(first.candidates[0]).not.toHaveProperty('cache');
      expect(second.outboundRequests).toBe(0);
      expect(second.candidates).toEqual([expect.objectContaining({ providerId: 'B1', cache: { fetchedAt: expect.any(String), stale: false } })]);
    });

    it('goes live under refresh and falls back to the saved answer when the provider fails', async () => {
      const { instance } = realExecutor();
      service = new AuthorMetadataFetchService(registry as never, instance);
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ asin: 'B1', name: 'Jane Doe' }]))
        .mockResolvedValueOnce(jsonResponse({ asin: 'B1', name: 'Jane Doe', description: 'Bio' }))
        .mockRejectedValue(new TypeError('fetch failed')) as never;

      await service.quickSearchDetailed({ name: 'Jane Doe' });
      const refreshed = await service.quickSearchDetailed({ name: 'Jane Doe' }, { directive: { policy: 'refresh', allowFallback: true } });

      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(refreshed.failure).toBeNull();
      expect(refreshed.candidate).toMatchObject({ providerId: 'B1', description: 'Bio' });
      expect(refreshed.cacheServed).toEqual([{ provider: 'audnexus', source: 'fallback', stale: false, cachedAt: expect.any(String) }]);
    });

    it('reports the failure under refresh without fallback', async () => {
      const { instance } = realExecutor();
      service = new AuthorMetadataFetchService(registry as never, instance);
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ asin: 'B1', name: 'Jane Doe' }]))
        .mockResolvedValueOnce(jsonResponse({ asin: 'B1', name: 'Jane Doe' }))
        .mockResolvedValue(jsonResponse({ message: 'busy' }, 503)) as never;

      await service.quickSearchDetailed({ name: 'Jane Doe' });
      const refreshed = await service.quickSearchDetailed({ name: 'Jane Doe' }, { directive: { policy: 'refresh', allowFallback: false } });

      expect(refreshed.candidate).toBeNull();
      expect(refreshed.failure).toMatchObject({ provider: 'audnexus', httpStatus: 503, transient: true });
      expect(refreshed.cacheServed).toEqual([]);
    });

    it('abandons a provider at the operation deadline and aborts its request', async () => {
      const { instance } = realExecutor();
      service = new AuthorMetadataFetchService(registry as never, instance);
      vi.spyOn(service as unknown as { createDeadline: () => AbortSignal }, 'createDeadline').mockImplementation(() => AbortSignal.timeout(20));
      let requestSignal: AbortSignal | undefined;
      global.fetch = vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }) as never;

      const result = await service.quickSearchDetailed({ name: 'Jane Doe' });

      expect(result.failure).toMatchObject({ provider: 'audnexus', message: 'Author metadata provider timeout', transient: true });
      expect(requestSignal?.aborted).toBe(true);
    });
  });
});
