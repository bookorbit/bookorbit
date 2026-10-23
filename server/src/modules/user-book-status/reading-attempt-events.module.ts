import { Module } from '@nestjs/common';
import { ReadingAttemptEventsService } from './reading-attempt-events.service';

@Module({
  providers: [ReadingAttemptEventsService],
  exports: [ReadingAttemptEventsService],
})
export class ReadingAttemptEventsModule {}
