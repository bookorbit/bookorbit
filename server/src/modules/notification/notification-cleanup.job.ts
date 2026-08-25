import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { NotificationService } from './notification.service';

@Injectable()
export class NotificationCleanupJob {
  constructor(private readonly notificationService: NotificationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    try {
      await this.notificationService.runRetentionCleanup();
    } catch {
      // error already logged in service
    }
  }
}
