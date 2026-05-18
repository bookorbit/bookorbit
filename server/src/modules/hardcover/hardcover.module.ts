import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { HardcoverAdminController } from './hardcover-admin.controller';
import { HardcoverBookMatchService } from './hardcover-book-match.service';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverController } from './hardcover.controller';
import { HardcoverEventListener } from './hardcover-event-listener.service';
import { HardcoverQueueService } from './hardcover-queue.service';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

@Module({
  imports: [AchievementModule, AppSettingsModule],
  controllers: [HardcoverController, HardcoverAdminController],
  providers: [
    HardcoverQueueService,
    HardcoverClientService,
    HardcoverRepository,
    HardcoverSettingsService,
    HardcoverBookMatchService,
    HardcoverSyncService,
    HardcoverEventListener,
  ],
  exports: [HardcoverSyncService, HardcoverSettingsService],
})
export class HardcoverModule {}
