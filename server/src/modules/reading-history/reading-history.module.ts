import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { ReadingAttemptEventsModule } from '../user-book-status/reading-attempt-events.module';
import { ReadingHistoryController } from './reading-history.controller';
import { ReadingHistoryRepository } from './reading-history.repository';
import { ReadingHistoryService } from './reading-history.service';

@Module({
  imports: [BookModule, ReadingAttemptEventsModule],
  controllers: [ReadingHistoryController],
  providers: [ReadingHistoryService, ReadingHistoryRepository],
})
export class ReadingHistoryModule {}
