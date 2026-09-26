import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { AuditService } from './audit.service';

@Injectable()
export class AuditCleanupJob {
  constructor(private readonly auditService: AuditService) {}

  @SystemCron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    try {
      await this.auditService.runRetentionCleanup();
    } catch {
      // error already logged in service
    }
  }
}
