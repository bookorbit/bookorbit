import { Module } from '@nestjs/common';

import { NotificationCleanupJob } from './notification-cleanup.job';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository, NotificationGateway, NotificationCleanupJob],
  exports: [NotificationService],
})
export class NotificationModule {}
