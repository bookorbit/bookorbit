import { Module } from '@nestjs/common';

import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';
import { UserStatisticsController } from './user-statistics.controller';
import { UserStatisticsRepository } from './user-statistics.repository';
import { UserStatisticsService } from './user-statistics.service';

@Module({
  controllers: [UserStatisticsController],
  providers: [UserStatisticsService, UserStatisticsRepository, UserStatisticsAggregationJob],
})
export class UserStatisticsModule {}
