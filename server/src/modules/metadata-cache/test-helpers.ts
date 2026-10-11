import { DEFAULT_METADATA_CACHE_CONFIG, type MetadataCacheConfig } from '@bookorbit/types';

import type { NewProviderMetadataCacheRow, ProviderMetadataCacheRow } from '../../db/schema';
import type { ClearMarker, MetadataCacheConfigService } from './metadata-cache-config.service';
import type { MetadataCacheRepository } from './metadata-cache.repository';
import type { MetadataCacheSweeper } from './metadata-cache-sweeper.service';
import { MetadataCacheAccessTracker, MetadataCacheBudget, MetadataCacheCounterService } from './metadata-cache-state';
import { ProviderOperationExecutor } from './provider-operation-executor.service';

/** Test double for the cache table: newest fetch wins, like the real upsert. */
export class InMemoryMetadataCacheRepository {
  readonly rows = new Map<string, ProviderMetadataCacheRow>();
  private nextId = 1;
  failReads = false;
  failWrites = false;

  find(keyHash: string): Promise<ProviderMetadataCacheRow | null> {
    if (this.failReads) return Promise.reject(new Error('read failed'));
    return Promise.resolve(this.rows.get(keyHash) ?? null);
  }

  upsert(row: NewProviderMetadataCacheRow): Promise<number> {
    if (this.failWrites) return Promise.reject(new Error('write failed'));
    const existing = this.rows.get(row.keyHash);
    if (existing && existing.fetchedAt > row.fetchedAt) return Promise.resolve(0);
    this.rows.set(row.keyHash, {
      id: existing?.id ?? this.nextId++,
      maxCandidates: null,
      coversValidated: false,
      upstreamMs: 0,
      ...row,
    } as ProviderMetadataCacheRow);
    return Promise.resolve(row.payloadBytes - (existing?.payloadBytes ?? 0));
  }

  delete(keyHash: string): Promise<void> {
    this.rows.delete(keyHash);
    return Promise.resolve();
  }

  touch(): Promise<void> {
    return Promise.resolve();
  }
}

export interface TestExecutorOptions {
  config?: Partial<MetadataCacheConfig>;
  markers?: ClearMarker[];
}

export interface TestExecutorHarness {
  executor: ProviderOperationExecutor;
  repository: InMemoryMetadataCacheRepository;
  counters: MetadataCacheCounterService;
  budget: MetadataCacheBudget;
  sweeper: { requestSweep: (reason: string) => void; requests: string[] };
  setConfig(config: Partial<MetadataCacheConfig>): void;
  setMarkers(markers: ClearMarker[]): void;
}

/** A real executor over an in-memory table, for tests of the executor and of its callers. */
export function createTestExecutor(options: TestExecutorOptions = {}): TestExecutorHarness {
  let config: MetadataCacheConfig = { ...DEFAULT_METADATA_CACHE_CONFIG, ...options.config };
  let markers: ClearMarker[] = options.markers ?? [];
  const configService = {
    snapshot: () => Promise.resolve({ config, markers }),
  } as unknown as MetadataCacheConfigService;
  const repository = new InMemoryMetadataCacheRepository();
  const counters = new MetadataCacheCounterService();
  const budget = new MetadataCacheBudget();
  const requests: string[] = [];
  const sweeper = { requestSweep: (reason: string) => void requests.push(reason), requests };
  const executor = new ProviderOperationExecutor(
    configService,
    repository as unknown as MetadataCacheRepository,
    counters,
    budget,
    new MetadataCacheAccessTracker(),
    sweeper as unknown as MetadataCacheSweeper,
  );
  return {
    executor,
    repository,
    counters,
    budget,
    sweeper,
    setConfig: (next) => {
      config = { ...config, ...next };
    },
    setMarkers: (next) => {
      markers = next;
    },
  };
}
