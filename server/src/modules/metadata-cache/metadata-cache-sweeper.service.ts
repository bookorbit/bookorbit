import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, inArray, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { providerMetadataCache as t } from '../../db/schema';
import {
  ACCESS_FLUSH_INTERVAL_MS,
  ACCESS_TOUCH_STALE_MS,
  BUDGET_EVICT_TARGET,
  CACHE_SCHEMA_VERSION,
  CLEAR_MARKER_RETENTION_MS,
  SWEEP_BATCH_SIZE,
  SWEEP_INTERVAL_MS,
  SWEEP_TIME_BUDGET_MS,
} from './metadata-cache.constants';
import { effectiveCacheSettings, MetadataCacheConfigService, type ClearMarker } from './metadata-cache-config.service';
import { hashFingerprint } from './metadata-cache-key';
import { MetadataCacheProviderCatalog } from './metadata-cache-provider-catalog';
import { MetadataCacheRepository, type DeletedBatch } from './metadata-cache.repository';
import { MetadataCacheAccessTracker, MetadataCacheBudget } from './metadata-cache-state';

const EMPTY_STATUSES = ['empty', 'not_found'];

interface SweepTotals {
  orphans: number;
  expired: number;
  cleared: number;
  evicted: number;
  bytes: number;
}

@Injectable()
export class MetadataCacheSweeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetadataCacheSweeper.name);
  private running: Promise<void> | null = null;
  private rerunReason: string | null = null;
  private lastSweepAt: Date | null = null;

  constructor(
    private readonly repository: MetadataCacheRepository,
    private readonly config: MetadataCacheConfigService,
    private readonly catalog: MetadataCacheProviderCatalog,
    private readonly budget: MetadataCacheBudget,
    private readonly access: MetadataCacheAccessTracker,
  ) {}

  onApplicationBootstrap(): void {
    void this.repository
      .sumPayloadBytes()
      .then((bytes) => this.budget.set(bytes))
      .catch(() => undefined);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  get lastRunAt(): Date | null {
    return this.lastSweepAt;
  }

  @Interval(SWEEP_INTERVAL_MS)
  scheduledSweep(): void {
    this.requestSweep('scheduled');
  }

  @Interval(ACCESS_FLUSH_INTERVAL_MS)
  async flushAccess(): Promise<void> {
    const keys = this.access.drain();
    if (keys.length === 0) return;
    const now = new Date();
    await this.repository.touch(keys, now, new Date(now.getTime() - ACCESS_TOUCH_STALE_MS)).catch(() => undefined);
  }

  /** At most one sweep runs; a request during a sweep schedules one more afterwards. */
  requestSweep(reason: string): void {
    if (this.running) {
      this.rerunReason = reason;
      return;
    }
    this.running = this.sweep(reason).finally(() => {
      this.running = null;
      const next = this.rerunReason;
      this.rerunReason = null;
      if (next) this.requestSweep(next);
    });
  }

  /** Waits for the current sweep, if any. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async sweep(reason: string): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + SWEEP_TIME_BUDGET_MS;
    this.logger.log(`[metadata_cache.sweep] [start] reason=${reason} - cache sweep started`);
    const totals: SweepTotals = { orphans: 0, expired: 0, cleared: 0, evicted: 0, bytes: 0 };
    try {
      const snapshot = await this.config.snapshot();
      totals.orphans = await this.deleteWhile(await this.orphanCondition(), deadline, totals);
      totals.expired = await this.deleteExpired(snapshot.config, deadline, totals);
      totals.cleared = await this.applyMarkers(snapshot.markers, deadline, totals);

      this.budget.set(await this.repository.sumPayloadBytes());
      totals.evicted = await this.enforceBudget(snapshot.config.maxStorageMb * 1024 * 1024, deadline, totals);
      this.lastSweepAt = new Date();
      this.logger.log(
        `[metadata_cache.sweep] [end] reason=${reason} durationMs=${Date.now() - startedAt} orphans=${totals.orphans} expired=${totals.expired} cleared=${totals.cleared} evicted=${totals.evicted} bytesFreed=${totals.bytes} liveBytes=${this.budget.bytes} - cache sweep completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[metadata_cache.sweep] [fail] reason=${reason} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - cache sweep failed`,
      );
    }
  }

  /** Rows no current provider would ever read: unknown providers, old versions, old configuration. */
  private async orphanCondition(): Promise<SQL> {
    const clauses: SQL[] = [];
    for (const namespace of Object.keys(CACHE_SCHEMA_VERSION) as (keyof typeof CACHE_SCHEMA_VERSION)[]) {
      const entries = this.catalog.list().filter((entry) => entry.namespace === namespace && entry.spec);
      const known = entries.map((entry) => entry.provider);
      const namespaceClauses: SQL[] = [ne(t.schemaVersion, CACHE_SCHEMA_VERSION[namespace])];
      if (known.length > 0) namespaceClauses.push(notInArray(t.provider, known));
      else namespaceClauses.push(sql`true`);
      for (const entry of entries) {
        const providerClauses: SQL[] = [ne(t.providerVersion, entry.spec!.version)];
        const context = await entry.spec!.context().catch(() => null);
        if (context) providerClauses.push(ne(t.configFingerprint, hashFingerprint(context.fingerprint)));
        namespaceClauses.push(and(eq(t.provider, entry.provider), or(...providerClauses))!);
      }
      clauses.push(and(eq(t.namespace, namespace), or(...namespaceClauses))!);
    }
    clauses.push(notInArray(t.namespace, Object.keys(CACHE_SCHEMA_VERSION)));
    return or(...clauses)!;
  }

  private async deleteExpired(
    config: Awaited<ReturnType<MetadataCacheConfigService['snapshot']>>['config'],
    deadline: number,
    totals: SweepTotals,
  ): Promise<number> {
    const now = Date.now();
    let deleted = 0;
    for (const entry of this.catalog.list()) {
      if (!entry.spec) continue;
      const settings = effectiveCacheSettings(config, entry.namespace, entry.provider);
      const resultsCutoff = new Date(now - settings.resultsTtlMs - settings.staleGraceMs);
      const emptyCutoff = new Date(now - settings.emptyTtlMs - settings.staleGraceMs);
      const condition = and(
        eq(t.namespace, entry.namespace),
        eq(t.provider, entry.provider),
        or(
          and(notInArray(t.status, EMPTY_STATUSES), lt(t.fetchedAt, resultsCutoff)),
          and(inArray(t.status, EMPTY_STATUSES), lt(t.fetchedAt, emptyCutoff)),
        ),
      )!;
      deleted += await this.deleteWhile(condition, deadline, totals);
      if (Date.now() >= deadline) break;
    }
    return deleted;
  }

  private async applyMarkers(markers: readonly ClearMarker[], deadline: number, totals: SweepTotals): Promise<number> {
    let deleted = 0;
    const finished: ClearMarker[] = [];
    for (const marker of markers) {
      const condition = markerCondition(marker);
      const removed = await this.deleteWhile(condition, deadline, totals);
      deleted += removed;
      if (Date.now() >= deadline) break;
      if (Date.now() - Date.parse(marker.at) >= CLEAR_MARKER_RETENTION_MS && (await this.repository.count(condition)) === 0) finished.push(marker);
    }
    if (finished.length > 0) await this.config.removeClearMarkers((marker) => finished.some((done) => sameMarker(done, marker)));
    return deleted;
  }

  private async enforceBudget(maxBytes: number, deadline: number, totals: SweepTotals): Promise<number> {
    if (!this.budget.needsSweep(maxBytes)) return 0;
    const target = maxBytes * BUDGET_EVICT_TARGET;
    let evicted = 0;
    while (this.budget.bytes > target && Date.now() < deadline) {
      const batch = await this.repository.deleteLeastRecentlyAccessed(SWEEP_BATCH_SIZE);
      this.account(batch, totals);
      evicted += batch.count;
      if (batch.count === 0) break;
    }
    return evicted;
  }

  /** Deletes matching rows in bounded batches until none are left or the sweep runs out of time. */
  async deleteWhile(condition: SQL, deadline: number, totals?: SweepTotals): Promise<number> {
    let deleted = 0;
    while (Date.now() < deadline) {
      const batch = await this.repository.deleteBatch(condition, SWEEP_BATCH_SIZE);
      if (totals) this.account(batch, totals);
      else this.budget.subtract(batch.bytes);
      deleted += batch.count;
      if (batch.count < SWEEP_BATCH_SIZE) break;
    }
    return deleted;
  }

  private account(batch: DeletedBatch, totals: SweepTotals): void {
    totals.bytes += batch.bytes;
    this.budget.subtract(batch.bytes);
  }
}

export function markerCondition(marker: Omit<ClearMarker, 'at'> & { at?: string }): SQL {
  const clauses: SQL[] = [];
  if (marker.namespace) clauses.push(eq(t.namespace, marker.namespace));
  if (marker.provider) clauses.push(eq(t.provider, marker.provider));
  if (marker.emptyOnly) clauses.push(inArray(t.status, EMPTY_STATUSES));
  if (marker.at) clauses.push(lt(t.fetchedAt, new Date(marker.at)));
  return clauses.length > 0 ? and(...clauses)! : sql`true`;
}

function sameMarker(a: ClearMarker, b: ClearMarker): boolean {
  return a.at === b.at && a.namespace === b.namespace && a.provider === b.provider && a.emptyOnly === b.emptyOnly;
}
