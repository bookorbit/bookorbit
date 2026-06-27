import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AchievementModule } from '../achievement/achievement.module';
import { AnnotationModule } from '../annotation/annotation.module';
import { BookModule } from '../book/book.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { UserModule } from '../user/user.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { KoboAuthController } from './kobo-auth.controller';
import { KoboDeviceController } from './kobo-device.controller';
import { KoboReadingServicesController } from './kobo-reading-services.controller';
import { KoboSyncController } from './kobo-sync.controller';
import { KoboUserController } from './kobo-user.controller';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KepubConversionService } from './services/kepub-conversion.service';
import { KoboBookAccessService } from './services/kobo-book-access.service';
import { KepubifyBinaryService } from './services/kepubify-binary.service';
import { KoboAnnotationExchangeService } from './services/kobo-annotation-exchange.service';
import { KoboAnnotationMaterializerService } from './services/kobo-annotation-materializer.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboKepubContextService } from './services/kobo-kepub-context.service';
import { KoboProgressBridgeService } from './services/kobo-progress-bridge.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboBookIdentityService } from './services/kobo-book-identity.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';
import { KoboAnalyticsResolverService } from './services/kobo-analytics-resolver.service';
import { KoboAnalyticsService } from './services/kobo-analytics.service';

@Module({
  imports: [
    CommonModule,
    AchievementModule,
    AnnotationModule,
    BookModule,
    PositionConverterModule,
    UserModule,
    UserBookStatusModule,
    ReadingSessionModule,
  ],
  controllers: [KoboUserController, KoboAuthController, KoboSyncController, KoboDeviceController, KoboReadingServicesController],
  providers: [
    KoboTokenGuard,
    KepubifyBinaryService,
    KepubConversionService,
    KoboDeviceService,
    KoboSettingsService,
    KoboBookAccessService,
    KoboSyncService,
    KoboBookIdentityService,
    KoboKepubContextService,
    KoboProgressBridgeService,
    KoboAnnotationMaterializerService,
    KoboAnnotationExchangeService,
    KoboReadingStateService,
    KoboThumbnailService,
    KoboDownloadService,
    KoboProxyService,
    KoboAnalyticsResolverService,
    KoboAnalyticsService,
  ],
  exports: [KepubConversionService, KoboSettingsService],
})
export class KoboModule {}
