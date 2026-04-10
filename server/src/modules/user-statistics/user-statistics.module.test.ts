import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';
import { UserStatisticsController } from './user-statistics.controller';
import { UserStatisticsModule } from './user-statistics.module';
import { UserStatisticsRepository } from './user-statistics.repository';
import { UserStatisticsService } from './user-statistics.service';

describe('UserStatisticsModule', () => {
  it('registers controller and providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, UserStatisticsModule)).toEqual([UserStatisticsController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, UserStatisticsModule)).toEqual([
      UserStatisticsService,
      UserStatisticsRepository,
      UserStatisticsAggregationJob,
    ]);
  });
});
