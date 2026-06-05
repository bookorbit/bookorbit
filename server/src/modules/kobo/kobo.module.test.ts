import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { KoboAuthController } from './kobo-auth.controller';
import { KoboDeviceController } from './kobo-device.controller';
import { KoboModule } from './kobo.module';
import { KoboSyncController } from './kobo-sync.controller';
import { KoboUserController } from './kobo-user.controller';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KepubConversionService } from './services/kepub-conversion.service';
import { KepubifyBinaryService } from './services/kepubify-binary.service';
import { KoboBookAccessService } from './services/kobo-book-access.service';
import { KoboBookIdentityService } from './services/kobo-book-identity.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';
import { KoboAnalyticsResolverService } from './services/kobo-analytics-resolver.service';
import { KoboAnalyticsService } from './services/kobo-analytics.service';
import { ReadingSessionModule } from '../reading-session/reading-session.module';

describe('KoboModule', () => {
  it('registers expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KoboModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KoboModule) as unknown[];
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, KoboModule) as unknown[];

    expect(imports).toContain(ReadingSessionModule);
    expect(controllers).toEqual([KoboUserController, KoboAuthController, KoboSyncController, KoboDeviceController]);
    expect(providers).toEqual([
      KoboTokenGuard,
      KepubifyBinaryService,
      KepubConversionService,
      KoboDeviceService,
      KoboSettingsService,
      KoboBookAccessService,
      KoboSyncService,
      KoboBookIdentityService,
      KoboReadingStateService,
      KoboThumbnailService,
      KoboDownloadService,
      KoboProxyService,
      KoboAnalyticsResolverService,
      KoboAnalyticsService,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, KoboModule)).toEqual([KepubConversionService, KoboSettingsService]);
  });
});
