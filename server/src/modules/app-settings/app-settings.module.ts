import { Module } from '@nestjs/common';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';

@Module({
  controllers: [AppSettingsController],
  providers: [AppSettingsRepository, AppSettingsService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
