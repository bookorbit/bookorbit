import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { UserBookStatusRepository } from './user-book-status.repository';
import { UserBookStatusService } from './user-book-status.service';

@Module({
  imports: [AchievementModule],
  providers: [UserBookStatusService, UserBookStatusRepository],
  exports: [UserBookStatusService],
})
export class UserBookStatusModule {}
