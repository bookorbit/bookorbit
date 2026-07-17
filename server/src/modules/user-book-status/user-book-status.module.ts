import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { UserBookStatusRepository } from './user-book-status.repository';
import { UserBookStatusService } from './user-book-status.service';
import { ReadingAttemptRepository } from './reading-attempt.repository';
import { ReadingAttemptService } from './reading-attempt.service';
import { ReadingAttemptBackfillService } from './reading-attempt-backfill.service';

@Module({
  imports: [AchievementModule],
  providers: [UserBookStatusService, UserBookStatusRepository, ReadingAttemptService, ReadingAttemptRepository, ReadingAttemptBackfillService],
  exports: [UserBookStatusService, ReadingAttemptService],
})
export class UserBookStatusModule {}
