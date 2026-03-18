import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AuditService } from './audit.service';

@Injectable()
export class AuditCleanupJob {
  private readonly logger = new Logger(AuditCleanupJob.name);

  constructor(private readonly auditService: AuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    try {
      await this.auditService.runRetentionCleanup();
    } catch (err) {
      this.logger.error('Audit retention cleanup failed', err);
    }
  }
}
