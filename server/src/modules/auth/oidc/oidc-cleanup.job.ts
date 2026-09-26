import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SystemCron } from '../../../common/decorators/system-cron.decorator';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { OidcCleanupService } from './oidc-cleanup.service';

@Injectable()
export class OidcCleanupJob {
  private readonly logger = new Logger(OidcCleanupJob.name);

  constructor(private readonly oidcCleanupService: OidcCleanupService) {}

  @SystemCron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup(): Promise<void> {
    const start = Date.now();
    this.logger.log('[auth.oidc_cleanup] [start] - OIDC cleanup started');
    try {
      const { deletedSessions, deletedStates, deletedJtis } = await this.oidcCleanupService.runCleanup();
      this.logger.log(
        `[auth.oidc_cleanup] [end] durationMs=${Date.now() - start} deletedSessions=${deletedSessions} deletedStates=${deletedStates} deletedJtis=${deletedJtis} - OIDC cleanup completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMsg = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[auth.oidc_cleanup] [fail] durationMs=${Date.now() - start} errorClass=${errorClass} error="${errorMsg}" - OIDC cleanup failed`,
      );
    }
  }
}
