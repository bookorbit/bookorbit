import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { AchievementModule } from '../achievement/achievement.module';
import { UserStatisticsModule } from '../user-statistics/user-statistics.module';
import { BookReadingSessionController } from './book-reading-session.controller';
import { ReadingSessionController } from './reading-session.controller';
import { ReadingSessionRepository } from './reading-session.repository';
import { ReadingSessionService } from './reading-session.service';

@Module({
  imports: [BookModule, AchievementModule, UserStatisticsModule],
  controllers: [ReadingSessionController, BookReadingSessionController],
  providers: [ReadingSessionService, ReadingSessionRepository],
  exports: [ReadingSessionService],
})
export class ReadingSessionModule {}
