import { Module } from '@nestjs/common';

import { DbModule } from '../../db/db.module';
import { AppAttestModule } from '../app-attest/app-attest.module';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesRepository } from './user-preferences.repository';
import { UserPreferencesService } from './user-preferences.service';

@Module({
  imports: [AppAttestModule, DbModule],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesService, UserPreferencesRepository],
})
export class UserPreferencesModule {}
