import { Injectable, Logger } from '@nestjs/common';
import type { MetadataCacheClearRequest, MetadataCacheClearResponse, MetadataCacheConfigResponse, MetadataCacheStats } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CLEAR_SYNC_BUDGET_MS } from './metadata-cache.constants';
import { MetadataCacheConfigService, type MetadataCacheConfigPatch } from './metadata-cache-config.service';
import { MetadataCacheProviderCatalog } from './metadata-cache-provider-catalog';
import { MetadataCacheRepository } from './metadata-cache.repository';
import { MetadataCacheSweeper, markerCondition } from './metadata-cache-sweeper.service';
import { MetadataCacheBudget, MetadataCacheCounterService } from './metadata-cache-state';

@Injectable()
export class MetadataCacheAdminService {
  private readonly logger = new Logger(MetadataCacheAdminService.name);

  constructor(
    private readonly config: MetadataCacheConfigService,
    private readonly catalog: MetadataCacheProviderCatalog,
    private readonly repository: MetadataCacheRepository,
    private readonly sweeper: MetadataCacheSweeper,
    private readonly counters: MetadataCacheCounterService,
    private readonly budget: MetadataCacheBudget,
  ) {}

  async getConfig(): Promise<MetadataCacheConfigResponse> {
    return { config: await this.config.getConfig(), providers: this.catalog.describe() };
  }

  async updateConfig(patch: MetadataCacheConfigPatch, userId: number): Promise<MetadataCacheConfigResponse> {
    const config = await this.config.updateConfig(patch);
    this.logger.log(
      `[metadata_cache.config_update] [end] userId=${userId} enabled=${config.enabled} overrides=${config.providerOverrides.length} - cache settings saved`,
    );
    this.sweeper.requestSweep('settings');
    return { config, providers: this.catalog.describe() };
  }

  async getStats(): Promise<MetadataCacheStats> {
    const [table, config] = await Promise.all([this.repository.stats(), this.config.getConfig()]);
    return {
      entries: table.entries,
      payloadBytes: table.payloadBytes,
      relationBytes: table.relationBytes,
      maxStorageBytes: config.maxStorageMb * 1024 * 1024,
      oldestFetchedAt: table.oldestFetchedAt?.toISOString() ?? null,
      providers: table.providers,
      counters: this.counters.snapshot(),
      sweepRunning: this.sweeper.isRunning,
      lastSweepAt: this.sweeper.lastRunAt?.toISOString() ?? null,
    };
  }

  /**
   * The marker is persisted first so in-flight writes started earlier are discarded and an
   * interrupted partial clear is resumed by the sweeper.
   */
  async clear(request: MetadataCacheClearRequest, userId: number): Promise<MetadataCacheClearResponse> {
    const startedAt = Date.now();
    const scope = `namespace=${request.namespace ?? 'all'} provider=${sanitizeLogValue(request.provider ?? 'all')} emptyOnly=${request.emptyOnly === true}`;
    this.logger.log(`[metadata_cache.clear] [start] userId=${userId} ${scope} - cache clear started`);
    try {
      const at = new Date();
      const marker = {
        ...(request.namespace ? { namespace: request.namespace } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.emptyOnly ? { emptyOnly: true } : {}),
      };
      await this.config.addClearMarker(marker, at);

      let deleted: number;
      let pending = false;
      if (!request.namespace && !request.provider && !request.emptyOnly) {
        deleted = await this.repository.count();
        await this.repository.truncate();
        this.budget.set(0);
      } else {
        const condition = markerCondition({ ...marker, at: at.toISOString() });
        deleted = await this.sweeper.deleteWhile(condition, Date.now() + CLEAR_SYNC_BUDGET_MS);
        pending = (await this.repository.count(condition)) > 0;
        if (pending) this.sweeper.requestSweep('clear');
      }
      this.logger.log(
        `[metadata_cache.clear] [end] userId=${userId} ${scope} durationMs=${Date.now() - startedAt} deleted=${deleted} pending=${pending} - cache clear completed`,
      );
      return { deleted, pending };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[metadata_cache.clear] [fail] userId=${userId} ${scope} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - cache clear failed`,
      );
      throw error;
    }
  }
}
