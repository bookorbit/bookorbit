import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { ReadwiseController } from './readwise.controller';
import { ReadwiseAutoSyncSchedulerService } from './readwise-auto-sync-scheduler.service';
import { ReadwiseClientService } from './readwise-client.service';
import { ReadwiseEventListener } from './readwise-event-listener.service';
import { ReadwiseQueueService } from './readwise-queue.service';
import { ReadwiseRepository } from './readwise.repository';
import { ReadwiseSettingsService } from './readwise-settings.service';
import { ReadwiseSyncService } from './readwise-sync.service';

@Module({
  imports: [AchievementModule],
  controllers: [ReadwiseController],
  providers: [
    ReadwiseQueueService,
    ReadwiseClientService,
    ReadwiseRepository,
    ReadwiseSettingsService,
    ReadwiseSyncService,
    ReadwiseAutoSyncSchedulerService,
    ReadwiseEventListener,
  ],
  exports: [ReadwiseSettingsService, ReadwiseSyncService],
})
export class ReadwiseModule {}
