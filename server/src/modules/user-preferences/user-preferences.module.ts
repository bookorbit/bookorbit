import { Module } from '@nestjs/common';

import { DbModule } from '../../db/db.module';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesRepository } from './user-preferences.repository';
import { UserPreferencesService } from './user-preferences.service';

@Module({
  imports: [DbModule],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesService, UserPreferencesRepository],
  exports: [UserPreferencesService],
})
export class UserPreferencesModule {}
