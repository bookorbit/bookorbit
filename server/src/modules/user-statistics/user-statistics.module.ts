import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserReadingStatsTimeZoneBackfillService } from './user-reading-stats-timezone-backfill.service';

import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';
import { UserStatisticsController } from './user-statistics.controller';
import { UserStatisticsRepository } from './user-statistics.repository';
import { UserStatisticsService } from './user-statistics.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [UserStatisticsController],
  providers: [UserStatisticsService, UserStatisticsRepository, UserStatisticsAggregationJob, UserReadingStatsTimeZoneBackfillService],
  exports: [UserStatisticsService],
})
export class UserStatisticsModule {}
