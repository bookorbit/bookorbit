import { Module } from '@nestjs/common';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';
import { OidcGroupMappingAdminService } from './oidc-group-mapping-admin.service';
import { OidcProviderRepository } from './oidc-provider.repository';
import { OidcProviderService } from './oidc-provider.service';

@Module({
  controllers: [AppSettingsController],
  providers: [AppSettingsRepository, AppSettingsService, OidcGroupMappingAdminService, OidcProviderRepository, OidcProviderService],
  exports: [AppSettingsService, OidcProviderService],
})
export class AppSettingsModule {}
