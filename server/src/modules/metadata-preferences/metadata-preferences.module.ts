import { Module } from '@nestjs/common';

import { MetadataHttpProviderModule } from '../metadata-http-provider/metadata-http-provider.module';
import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesController } from './metadata-preferences.controller';
import { MetadataPreferencesService } from './metadata-preferences.service';
import { ProviderConfigController } from './provider-config.controller';
import { ProviderConfigService } from './provider-config.service';
import { ProviderLinkSettingsController } from './provider-link-settings.controller';

@Module({
  imports: [MetadataHttpProviderModule],
  controllers: [MetadataPreferencesController, ProviderConfigController, ProviderLinkSettingsController],
  providers: [MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService],
  exports: [MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService],
})
export class MetadataPreferencesModule {}
