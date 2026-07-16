import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ReadingInsightsSharingController } from './reading-insights-sharing.controller';
import { SharedReadingInsightsController } from './shared-reading-insights.controller';
import { SharedReadingInsightsRepository } from './shared-reading-insights.repository';
import { SharedReadingInsightsService } from './shared-reading-insights.service';

@Module({
  imports: [AuditModule],
  controllers: [ReadingInsightsSharingController, SharedReadingInsightsController],
  providers: [SharedReadingInsightsService, SharedReadingInsightsRepository],
})
export class SharedReadingInsightsModule {}
