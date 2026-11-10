import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { API_KEY_RETENTION_DAYS, ApiKeyService } from './api-key.service';

@Injectable()
export class ApiKeyCleanupJob {
  private readonly logger = new Logger(ApiKeyCleanupJob.name);

  constructor(private readonly apiKeys: ApiKeyService) {}

  @SystemCron(CronExpression.EVERY_DAY_AT_1AM)
  async runCleanup(): Promise<void> {
    const start = Date.now();
    this.logger.log(`[api-key.cleanup] [start] retentionDays=${API_KEY_RETENTION_DAYS} - pruning stale API keys`);
    try {
      const deleted = await this.apiKeys.pruneStale();
      this.logger.log(`[api-key.cleanup] [end] deleted=${deleted} durationMs=${Date.now() - start} - stale API keys pruned`);
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[api-key.cleanup] [fail] durationMs=${Date.now() - start} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - pruning stale API keys failed`,
      );
    }
  }
}
