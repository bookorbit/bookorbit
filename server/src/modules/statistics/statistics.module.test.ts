import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { StatisticsController } from './statistics.controller';
import { StatisticsModule } from './statistics.module';
import { StatisticsRepository } from './statistics.repository';
import { StatisticsService } from './statistics.service';

describe('StatisticsModule', () => {
  it('registers controller and providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule)).toEqual([StatisticsController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StatisticsModule)).toEqual([StatisticsService, StatisticsRepository]);
  });
});
