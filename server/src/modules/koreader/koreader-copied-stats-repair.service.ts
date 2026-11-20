import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { KoreaderPluginRepository, type CopiedStatsRepairCursor } from './koreader-plugin.repository';

const BATCH_SIZE = 200;
const REPAIR_SETTING_KEY = 'koreader_copied_stats_repair_v1';
const EVENT = 'koreader.copied_stats_repair';

/**
 * Collapses the sessions a device derived from page events another device had already reported.
 * Copying KOReader statistics between devices sends the same events up twice, once per device id,
 * and derivation used to store a session for each, so reading time, streaks and achievements
 * counted those minutes once per device. Ingest now leaves a copy out of derivation; this pass
 * repairs what was stored before it did.
 *
 * Runs once per installation, resumable in book-file batches, and does nothing for an installation
 * whose devices never exchanged statistics. A failed pass leaves the marker unset and is retried on
 * the next boot; a repeat is harmless because derivation reads nothing but the stored events.
 */
@Injectable()
export class KoreaderCopiedStatsRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KoreaderCopiedStatsRepairService.name);

  constructor(
    private readonly pluginRepo: KoreaderPluginRepository,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    const startedAt = Date.now();
    void this.run().catch((error: unknown) => this.logFailure(error, startedAt));
  }

  async run(): Promise<{ skipped: boolean; bookFiles: number; removedSessions: number }> {
    if (await this.appSettings.getValue(REPAIR_SETTING_KEY)) {
      return { skipped: true, bookFiles: 0, removedSessions: 0 };
    }

    const startedAt = Date.now();
    let bookFiles = 0;
    let removedSessions = 0;
    let cursor: CopiedStatsRepairCursor | null = null;

    this.logger.log(`[${EVENT}] [start] batchSize=${BATCH_SIZE} - collapsing sessions derived from page events copied between devices`);

    for (;;) {
      const batch = await this.pluginRepo.repairCopiedStatsBatch(cursor, BATCH_SIZE);
      bookFiles += batch.bookFiles;
      removedSessions += batch.removedSessions;
      if (!batch.nextCursor) break;
      cursor = batch.nextCursor;
    }

    await this.appSettings.setValue(REPAIR_SETTING_KEY, new Date().toISOString());

    this.logger.log(
      `[${EVENT}] [end] durationMs=${Date.now() - startedAt} bookFiles=${bookFiles} removedSessions=${removedSessions} - sessions derived from copied page events collapsed`,
    );

    return { skipped: false, bookFiles, removedSessions };
  }

  private logFailure(error: unknown, startedAt: number): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
    this.logger.error(
      `[${EVENT}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - collapsing sessions derived from copied page events failed`,
    );
  }
}
