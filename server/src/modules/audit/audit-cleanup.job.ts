import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AuditService } from './audit.service';

@Injectable()
export class AuditCleanupJob {
  constructor(private readonly auditService: AuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    try {
      await this.auditService.runRetentionCleanup();
    } catch {
      // error already logged in service
    }
  }
}
