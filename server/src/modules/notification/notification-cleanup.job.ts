import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationCleanupJob {
  constructor(private readonly notificationService: NotificationService) {}

  @SystemCron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    try {
      await this.notificationService.runRetentionCleanup();
    } catch {
      // error already logged in service
    }
  }
}
