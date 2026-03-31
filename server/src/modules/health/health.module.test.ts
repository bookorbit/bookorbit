import 'reflect-metadata';

import { HealthController } from './health.controller';
import { HealthModule } from './health.module';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';

describe('HealthModule', () => {
  it('registers expected controller/providers', () => {
    expect(Reflect.getMetadata('controllers', HealthModule)).toEqual([HealthController]);
    expect(Reflect.getMetadata('providers', HealthModule)).toEqual([HealthService, HealthRepository]);
  });
});
