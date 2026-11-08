import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { ReadingHistoryModule } from '../reading-history/reading-history.module';
import { ReadingAttemptEventsModule } from '../user-book-status/reading-attempt-events.module';
import { YearReviewController } from './year-review.controller';
import { YearReviewRepository } from './year-review.repository';
import { YearReviewService } from './year-review.service';

@Module({
  imports: [AppAttestModule, ReadingHistoryModule, ReadingAttemptEventsModule],
  controllers: [YearReviewController],
  providers: [YearReviewService, YearReviewRepository],
})
export class YearReviewModule {}
