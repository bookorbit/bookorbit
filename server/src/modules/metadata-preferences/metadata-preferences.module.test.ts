import { MODULE_METADATA } from '@nestjs/common/constants';

import { MetadataPreferenceResolver } from './metadata-preference-resolver';
import { MetadataPreferencesController } from './metadata-preferences.controller';
import { MetadataPreferencesModule } from './metadata-preferences.module';
import { MetadataPreferencesService } from './metadata-preferences.service';
import { ProviderConfigController } from './provider-config.controller';
import { ProviderConfigService } from './provider-config.service';

describe('MetadataPreferencesModule', () => {
  it('registers expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, MetadataPreferencesModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MetadataPreferencesModule);
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, MetadataPreferencesModule);

    expect(controllers).toEqual(expect.arrayContaining([MetadataPreferencesController, ProviderConfigController]));
    expect(providers).toEqual(expect.arrayContaining([MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService]));
    expect(exports).toEqual(expect.arrayContaining([MetadataPreferencesService, MetadataPreferenceResolver, ProviderConfigService]));
  });
});
