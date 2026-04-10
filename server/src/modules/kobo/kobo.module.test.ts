import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { KoboAuthController } from './kobo-auth.controller';
import { KoboDeviceController } from './kobo-device.controller';
import { KoboModule } from './kobo.module';
import { KoboSyncController } from './kobo-sync.controller';
import { KoboUserController } from './kobo-user.controller';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KepubifyBinaryService } from './services/kepubify-binary.service';
import { KoboBookAccessService } from './services/kobo-book-access.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';

describe('KoboModule', () => {
  it('registers expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KoboModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KoboModule) as unknown[];

    expect(controllers).toEqual([KoboUserController, KoboAuthController, KoboSyncController, KoboDeviceController]);
    expect(providers).toEqual([
      KoboTokenGuard,
      KepubifyBinaryService,
      KoboDeviceService,
      KoboSettingsService,
      KoboBookAccessService,
      KoboSyncService,
      KoboReadingStateService,
      KoboThumbnailService,
      KoboDownloadService,
      KoboProxyService,
    ]);
  });
});
