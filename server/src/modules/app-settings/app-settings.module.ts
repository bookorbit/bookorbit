import { Module } from '@nestjs/common';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';
import { OidcGroupMappingAdminService } from './oidc-group-mapping-admin.service';

@Module({
  controllers: [AppSettingsController],
  providers: [AppSettingsRepository, AppSettingsService, OidcGroupMappingAdminService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
