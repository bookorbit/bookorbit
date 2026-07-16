import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AccountActivityController } from './account-activity.controller';
import { AccountActivityModule } from './account-activity.module';
import { AccountActivityRepository } from './account-activity.repository';
import { AccountActivityService } from './account-activity.service';

describe('AccountActivityModule', () => {
  it('registers its controller and providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AccountActivityModule)).toEqual([AccountActivityController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AccountActivityModule)).toEqual([AccountActivityService, AccountActivityRepository]);
  });
});
