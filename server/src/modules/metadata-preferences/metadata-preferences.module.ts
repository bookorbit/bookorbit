import { Module } from '@nestjs/common';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesController } from './metadata-preferences.controller';
import { MetadataPreferencesService } from './metadata-preferences.service';
import { ProviderConfigController } from './provider-config.controller';
import { ProviderConfigService } from './provider-config.service';

@Module({
  controllers: [MetadataPreferencesController, ProviderConfigController],
  providers: [MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService],
  exports: [MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService],
})
export class MetadataPreferencesModule {}
