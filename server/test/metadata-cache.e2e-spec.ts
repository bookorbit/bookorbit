import { Permission, type MetadataCacheConfigResponse, type MetadataCacheStats } from '@bookorbit/types';
import { sql } from 'drizzle-orm';

import { recordProviderRequest } from '../src/common/provider-cache/provider-call-context';
import * as schema from '../src/db/schema';
import { MetadataCacheRepository } from '../src/modules/metadata-cache/metadata-cache.repository';
import { hashFingerprint } from '../src/modules/metadata-cache/metadata-cache-key';
import { MetadataCacheProviderCatalog } from '../src/modules/metadata-cache/metadata-cache-provider-catalog';
import { MetadataCacheSweeper } from '../src/modules/metadata-cache/metadata-cache-sweeper.service';
import { ProviderOperationExecutor } from '../src/modules/metadata-cache/provider-operation-executor.service';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createUserAndLogin,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;

function row(keyHash: string, overrides: Partial<schema.NewProviderMetadataCacheRow> = {}): schema.NewProviderMetadataCacheRow {
  const now = new Date();
  return {
    keyHash,
    namespace: 'book',
    provider: 'google',
    operation: 'search',
    status: 'results',
    schemaVersion: 1,
    providerVersion: 1,
    configFingerprint: '0'.repeat(16),
    maxCandidates: null,
    coversValidated: false,
    payload: '[]',
    payloadBytes: 2,
    fetchedAt: now,
    lastAccessedAt: now,
    upstreamMs: 0,
    ...overrides,
  };
}

function key(n: number): string {
  return n.toString(16).padStart(64, '0');
}

describe('Metadata provider cache (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let repository!: MetadataCacheRepository;
  let admin!: TestUserSession;
  let reader!: TestUserSession;

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    repository = ctx.app.get(MetadataCacheRepository);
    admin = await createUserAndLogin(ctx, { permissions: [Permission.ManageMetadataConfig] });
    reader = await createUserAndLogin(ctx, { permissions: [] });
  });

  beforeEach(async () => {
    await ctx.db.execute(sql`TRUNCATE TABLE provider_metadata_cache`);
    await ctx.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} in ('metadata_cache_config', 'metadata_cache_clear_markers')`);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  describe('repository', () => {
    it('keeps the newest fetch and lets a later write win a tie', async () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');
      await repository.upsert(row(key(1), { payload: '["newer"]', fetchedAt: newer }));
      await repository.upsert(row(key(1), { payload: '["older"]', fetchedAt: older }));
      expect((await repository.find(key(1)))?.payload).toBe('["newer"]');

      await repository.upsert(row(key(1), { payload: '["tie"]', fetchedAt: newer }));
      expect((await repository.find(key(1)))?.payload).toBe('["tie"]');
    });

    it('reports how many bytes each write added: all of a new row, the difference for a replacement, none for an older answer', async () => {
      const first = new Date('2026-03-01T00:00:00Z');
      const later = new Date('2026-03-02T00:00:00Z');

      expect(await repository.upsert(row(key(3), { payloadBytes: 100, fetchedAt: first }))).toBe(100);
      expect(await repository.upsert(row(key(3), { payloadBytes: 130, fetchedAt: later }))).toBe(30);
      expect(await repository.upsert(row(key(3), { payloadBytes: 90, fetchedAt: later }))).toBe(-40);
      expect(await repository.upsert(row(key(3), { payloadBytes: 500, fetchedAt: first }))).toBe(0);
      expect((await repository.find(key(3)))?.payloadBytes).toBe(90);
    });

    it('round-trips scraped text that jsonb would reject', async () => {
      const payload = JSON.stringify([{ title: 'nul\u0000 and lone \ud800 surrogate' }]);
      await repository.upsert(row(key(2), { payload, payloadBytes: Buffer.byteLength(payload) }));

      const stored = await repository.find(key(2));

      expect(JSON.parse(stored!.payload)).toEqual([{ title: 'nul\u0000 and lone \ud800 surrogate' }]);
    });

    it('deletes in bounded batches and reports the bytes it freed', async () => {
      for (let i = 0; i < 5; i++) await repository.upsert(row(key(10 + i), { payloadBytes: 100 }));

      const batch = await repository.deleteBatch(sql`${schema.providerMetadataCache.provider} = 'google'`, 3);

      expect(batch).toEqual({ count: 3, bytes: 300 });
      expect(await repository.count()).toBe(2);
    });

    it('evicts the least recently used entries first', async () => {
      await repository.upsert(row(key(20), { lastAccessedAt: new Date('2026-01-01T00:00:00Z') }));
      await repository.upsert(row(key(21), { lastAccessedAt: new Date('2026-03-01T00:00:00Z') }));

      await repository.deleteLeastRecentlyAccessed(1);

      expect(await repository.find(key(20))).toBeNull();
      expect(await repository.find(key(21))).not.toBeNull();
    });

    it('reports per-provider stats and table size', async () => {
      await repository.upsert(row(key(30), { payloadBytes: 10 }));
      await repository.upsert(row(key(31), { status: 'empty', payloadBytes: 2 }));
      await repository.upsert(row(key(32), { namespace: 'author', provider: 'audnexus', payloadBytes: 5 }));

      const stats = await repository.stats();

      expect(stats.entries).toBe(3);
      expect(stats.payloadBytes).toBe(17);
      expect(stats.relationBytes).toBeGreaterThan(0);
      expect(stats.providers).toEqual(
        expect.arrayContaining([
          { namespace: 'book', provider: 'google', entries: 2, emptyEntries: 1, payloadBytes: 12 },
          { namespace: 'author', provider: 'audnexus', entries: 1, emptyEntries: 0, payloadBytes: 5 },
        ]),
      );
    });
  });

  describe('executor against the real table', () => {
    it('stores a complete answer and serves the repeat from Postgres', async () => {
      const executor = ctx.app.get(ProviderOperationExecutor);
      const live = vi.fn(() => {
        recordProviderRequest('GET https://example.test/q', { kind: 'status', status: 200 });
        return Promise.resolve([{ id: 'a' }]);
      });
      const request = {
        namespace: 'book' as const,
        provider: 'google',
        operation: 'search' as const,
        spec: {
          version: 1,
          trustEmpty: false,
          context: () => Promise.resolve({ available: true, fingerprint: '{}' }),
          describeSearch: () => ({ inputs: {} }),
          describeLookup: () => ({ inputs: {} }),
        },
        descriptor: { inputs: { title: 'e2e' } },
        directive: { policy: 'default' as const, allowFallback: true },
        codec: {
          isEmpty: (value: { id: string }[]) => value.length === 0,
          sanitize: (value: { id: string }[]) => value,
          parse: (payload: unknown) => (Array.isArray(payload) ? (payload as { id: string }[]) : undefined),
          slice: (value: { id: string }[], max: number) => value.slice(0, max),
          publishedDates: () => [],
        },
        live,
        classifyError: () => ({ outcome: 'failed' as const }),
      };

      const first = await executor.execute(request);
      const second = await executor.execute(request);

      expect(first.source).toBe('live');
      expect(second).toMatchObject({ source: 'cache', value: [{ id: 'a' }] });
      expect(live).toHaveBeenCalledTimes(1);
      expect(await repository.count()).toBe(1);
    });
  });

  describe('sweeper', () => {
    it('removes orphaned, expired and cleared entries and evicts down to the budget', async () => {
      const sweeper = ctx.app.get(MetadataCacheSweeper);
      const catalog = ctx.app.get(MetadataCacheProviderCatalog);
      const google = catalog.get('book', 'google')!;
      const fingerprint = hashFingerprint((await google.spec!.context()).fingerprint);
      const fresh = new Date();
      const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

      await repository.upsert(row(key(50), { configFingerprint: fingerprint, fetchedAt: fresh }));
      await repository.upsert(row(key(51), { provider: 'retired-provider', configFingerprint: fingerprint }));
      await repository.upsert(row(key(52), { providerVersion: 999, configFingerprint: fingerprint }));
      await repository.upsert(row(key(53), { configFingerprint: 'f'.repeat(16) }));
      await repository.upsert(row(key(54), { configFingerprint: fingerprint, fetchedAt: longAgo }));

      sweeper.requestSweep('test');
      await sweeper.idle();

      expect(await repository.find(key(50))).not.toBeNull();
      for (const removed of [51, 52, 53, 54]) expect(await repository.find(key(removed))).toBeNull();
    });
  });

  describe('admin API', () => {
    it('requires the metadata config permission', async () => {
      for (const route of [
        { method: 'GET' as const, url: '/api/v1/metadata-cache/config' },
        { method: 'PUT' as const, url: '/api/v1/metadata-cache/config', payload: {} },
        { method: 'GET' as const, url: '/api/v1/metadata-cache/stats' },
        { method: 'DELETE' as const, url: '/api/v1/metadata-cache' },
      ]) {
        const response = await ctx.app.inject({ ...route, headers: authHeader(reader.accessToken) });
        expect(response.statusCode).toBe(403);
      }
    });

    it('reads defaults and the providers that can be configured', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/metadata-cache/config', headers: authHeader(admin.accessToken) });

      expect(response.statusCode).toBe(200);
      const body = response.json<MetadataCacheConfigResponse>();
      expect(body.config).toMatchObject({ enabled: true, resultsTtlSeconds: 7 * 86400, emptyTtlSeconds: 7 * 86400, staleGraceSeconds: 7 * 86400 });
      expect(body.providers).toEqual(expect.arrayContaining([expect.objectContaining({ namespace: 'book', provider: 'google', cacheable: true })]));
    });

    it('saves valid settings and rejects out-of-range values and unknown providers', async () => {
      const saved = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/metadata-cache/config',
        headers: authHeader(admin.accessToken),
        payload: { resultsTtlSeconds: 14 * 86400, providerOverrides: [{ namespace: 'book', provider: 'google', enabled: false }] },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json<MetadataCacheConfigResponse>().config).toMatchObject({
        resultsTtlSeconds: 14 * 86400,
        providerOverrides: [{ namespace: 'book', provider: 'google', enabled: false }],
      });

      const outOfRange = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/metadata-cache/config',
        headers: authHeader(admin.accessToken),
        payload: { resultsTtlSeconds: 1 },
      });
      expect(outOfRange.statusCode).toBe(400);

      const unknown = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/metadata-cache/config',
        headers: authHeader(admin.accessToken),
        payload: { providerOverrides: [{ namespace: 'book', provider: 'nope' }] },
      });
      expect(unknown.statusCode).toBe(400);

      const extraField = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/metadata-cache/config',
        headers: authHeader(admin.accessToken),
        payload: { surprise: true },
      });
      expect(extraField.statusCode).toBe(400);
    });

    it('clears one provider and then everything, and reports stats', async () => {
      await repository.upsert(row(key(40)));
      await repository.upsert(row(key(41), { provider: 'amazon' }));

      const partial = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/metadata-cache?namespace=book&provider=amazon',
        headers: authHeader(admin.accessToken),
      });
      expect(partial.json()).toEqual({ deleted: 1, pending: false });
      expect(await repository.find(key(40))).not.toBeNull();

      const stats = await ctx.app.inject({ method: 'GET', url: '/api/v1/metadata-cache/stats', headers: authHeader(admin.accessToken) });
      expect(stats.json<MetadataCacheStats>()).toMatchObject({ entries: 1, counters: expect.any(Object) });

      const all = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/metadata-cache', headers: authHeader(admin.accessToken) });
      expect(all.json()).toEqual({ deleted: 1, pending: false });
      expect(await repository.count()).toBe(0);
    });
  });

  it('advertises the cache to clients through app info', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/app-info', headers: authHeader(reader.accessToken) });

    expect(response.json<{ features?: string[] }>().features).toContain('metadata-search-cache');
  });
});
