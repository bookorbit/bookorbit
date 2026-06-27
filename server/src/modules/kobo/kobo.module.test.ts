import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { KoboAuthController } from './kobo-auth.controller';
import { KoboDeviceController } from './kobo-device.controller';
import { KoboModule } from './kobo.module';
import { KoboReadingServicesController } from './kobo-reading-services.controller';
import { KoboSyncController } from './kobo-sync.controller';
import { KoboUserController } from './kobo-user.controller';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KepubConversionService } from './services/kepub-conversion.service';
import { KepubifyBinaryService } from './services/kepubify-binary.service';
import { KoboAnnotationExchangeService } from './services/kobo-annotation-exchange.service';
import { KoboAnnotationMaterializerService } from './services/kobo-annotation-materializer.service';
import { KoboBookAccessService } from './services/kobo-book-access.service';
import { KoboBookIdentityService } from './services/kobo-book-identity.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboKepubContextService } from './services/kobo-kepub-context.service';
import { KoboProgressBridgeService } from './services/kobo-progress-bridge.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';
import { KoboAnalyticsResolverService } from './services/kobo-analytics-resolver.service';
import { KoboAnalyticsService } from './services/kobo-analytics.service';
import { AnnotationModule } from '../annotation/annotation.module';
import { BookModule } from '../book/book.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { ReadingSessionModule } from '../reading-session/reading-session.module';

describe('KoboModule', () => {
  it('registers expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KoboModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KoboModule) as unknown[];
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, KoboModule) as unknown[];

    expect(imports).toContain(BookModule);
    expect(imports).toContain(ReadingSessionModule);
    expect(imports).toContain(AnnotationModule);
    expect(imports).toContain(PositionConverterModule);
    expect(controllers).toEqual([KoboUserController, KoboAuthController, KoboSyncController, KoboDeviceController, KoboReadingServicesController]);
    expect(providers).toEqual([
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
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, KoboModule)).toEqual([KepubConversionService, KoboSettingsService]);
  });
});
