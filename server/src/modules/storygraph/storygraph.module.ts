import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { StorygraphAutoSyncSchedulerService } from './storygraph-auto-sync-scheduler.service';
import { StorygraphBookMatchService } from './storygraph-book-match.service';
import { StorygraphClientService } from './storygraph-client.service';
import { StorygraphController } from './storygraph.controller';
import { StorygraphEventListener } from './storygraph-event-listener.service';
import { StorygraphQueueService } from './storygraph-queue.service';
import { StorygraphRepository } from './storygraph.repository';
import { StorygraphSettingsService } from './storygraph-settings.service';
import { StorygraphSyncService } from './storygraph-sync.service';

@Module({
  imports: [AchievementModule, BookModule, LibraryModule],
  controllers: [StorygraphController],
  providers: [
    StorygraphQueueService,
    StorygraphClientService,
    StorygraphRepository,
    StorygraphSettingsService,
    StorygraphBookMatchService,
    StorygraphSyncService,
    StorygraphAutoSyncSchedulerService,
    StorygraphEventListener,
  ],
  exports: [StorygraphSyncService, StorygraphSettingsService],
})
export class StorygraphModule {}
