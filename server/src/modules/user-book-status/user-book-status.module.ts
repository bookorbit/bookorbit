import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { KoboStatusProjectionRepository } from './kobo-status-projection.repository';
import { UserBookStatusRepository } from './user-book-status.repository';
import { UserBookStatusService } from './user-book-status.service';
import { ReadingAttemptRepository } from './reading-attempt.repository';
import { ReadingAttemptService } from './reading-attempt.service';
import { ReadingAttemptBackfillService } from './reading-attempt-backfill.service';
import { ReadingAttemptEventsModule } from './reading-attempt-events.module';

@Module({
  imports: [AchievementModule, ReadingAttemptEventsModule],
  providers: [
    UserBookStatusService,
    UserBookStatusRepository,
    KoboStatusProjectionRepository,
    ReadingAttemptService,
    ReadingAttemptRepository,
    ReadingAttemptBackfillService,
  ],
  exports: [UserBookStatusService, ReadingAttemptService, ReadingAttemptEventsModule],
})
export class UserBookStatusModule {}
