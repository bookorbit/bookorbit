import { Module } from '@nestjs/common';

import { AccountActivityController } from './account-activity.controller';
import { AccountActivityRepository } from './account-activity.repository';
import { AccountActivityService } from './account-activity.service';

@Module({
  controllers: [AccountActivityController],
  providers: [AccountActivityService, AccountActivityRepository],
})
export class AccountActivityModule {}
