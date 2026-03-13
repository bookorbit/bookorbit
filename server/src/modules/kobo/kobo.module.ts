import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { UserModule } from '../user/user.module';
import { KoboAuthController } from './kobo-auth.controller';
import { KoboDeviceController } from './kobo-device.controller';
import { KoboSyncController } from './kobo-sync.controller';
import { KoboUserController } from './kobo-user.controller';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KepubifyBinaryService } from './services/kepubify-binary.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';

@Module({
  imports: [CommonModule, UserModule],
  controllers: [KoboUserController, KoboAuthController, KoboSyncController, KoboDeviceController],
  providers: [
    KoboTokenGuard,
    KepubifyBinaryService,
    KoboDeviceService,
    KoboSettingsService,
    KoboSyncService,
    KoboReadingStateService,
    KoboThumbnailService,
    KoboDownloadService,
    KoboProxyService,
  ],
})
export class KoboModule {}
