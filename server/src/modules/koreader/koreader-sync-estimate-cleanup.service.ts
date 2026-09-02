import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { ReadingSessionService } from '../reading-session/reading-session.service';

const BATCH_SIZE = 500;
const CLEANUP_SETTING_KEY = 'koreader_sync_estimate_cleanup_v1';
const EVENT = 'koreader.sync_estimate_cleanup';

@Injectable()
export class KoreaderSyncEstimateCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KoreaderSyncEstimateCleanupService.name);

  constructor(
    private readonly readingSessions: ReadingSessionService,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    const startedAt = Date.now();
    void this.run().catch((error: unknown) => this.logFailure(error, startedAt));
  }

  async run(): Promise<{ skipped: boolean; deleted: number }> {
    if (await this.appSettings.getValue(CLEANUP_SETTING_KEY)) {
      return { skipped: true, deleted: 0 };
    }

    const startedAt = Date.now();
    let deleted = 0;

    this.logger.log(`[${EVENT}] [start] batchSize=${BATCH_SIZE} - removing sessions estimated from KOReader progress sync`);

    for (;;) {
      const batch = await this.readingSessions.deleteLegacyKoreaderSyncEstimatesBatch(BATCH_SIZE);
      deleted += batch.deleted;
      if (batch.deleted < BATCH_SIZE) break;
    }

    await this.appSettings.setValue(CLEANUP_SETTING_KEY, new Date().toISOString());

    this.logger.log(
      `[${EVENT}] [end] durationMs=${Date.now() - startedAt} deleted=${deleted} - sessions estimated from KOReader progress sync removed`,
    );

    return { skipped: false, deleted };
  }

  private logFailure(error: unknown, startedAt: number): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
    this.logger.error(
      `[${EVENT}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - removing sessions estimated from KOReader progress sync failed`,
    );
  }
}
