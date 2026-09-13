import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';

import { AppSettingsController } from './app-settings.controller';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';
import { OidcGroupMappingAdminService } from './oidc-group-mapping-admin.service';
import { OidcProviderRepository } from './oidc-provider.repository';
import { OidcProviderService } from './oidc-provider.service';

@Module({
  imports: [CommonModule],
  controllers: [AppSettingsController],
  providers: [AppSettingsRepository, AppSettingsService, OidcGroupMappingAdminService, OidcProviderRepository, OidcProviderService],
  exports: [AppSettingsService, OidcProviderService],
})
export class AppSettingsModule {}
