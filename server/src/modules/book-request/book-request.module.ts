import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BookDockModule } from '../book-dock/book-dock.module';
import { LibraryModule } from '../library/library.module';
import { NotificationModule } from '../notification/notification.module';
import { UploadModule } from '../upload/upload.module';
import { UserModule } from '../user/user.module';
import { BookRequestAdminController } from './book-request-admin.controller';
import { BookRequestAutomationController } from './book-request-automation.controller';
import { BookRequestAttributionService } from './book-request-attribution.service';
import { BookRequestController } from './book-request.controller';
import { BookRequestSelfFulfilController } from './book-request-self-fulfil.controller';
import { BookRequestDedupeService } from './book-request-dedupe.service';
import { BookRequestEventsService } from './book-request-events.service';
import { BookRequestGateway } from './book-request.gateway';
import { BookRequestNotifier } from './book-request-notifier.service';
import { BookRequestRepository } from './book-request.repository';
import { BookRequestService } from './book-request.service';
import { RequestCredentialService } from './request-credential.service';
import { DOWNLOAD_CLIENT_ADAPTERS } from './download-clients/download-client-adapter';
import { DownloadClientConfigService } from './download-clients/download-client-config.service';
import { DownloadClientController } from './download-clients/download-client.controller';
import { DownloadClientRegistry } from './download-clients/download-client-registry';
import { DownloadClientRepository } from './download-clients/download-client.repository';
import { PathMappingService } from './download-clients/path-mapping.service';
import { QbittorrentAdapter } from './download-clients/adapters/qbittorrent.adapter';
import { TransmissionAdapter } from './download-clients/adapters/transmission.adapter';
import { DelugeAdapter } from './download-clients/adapters/deluge.adapter';
import { INDEXER_ADAPTERS } from './indexers/indexer-adapter';
import { IndexerConfigService } from './indexers/indexer-config.service';
import { IndexerController } from './indexers/indexer.controller';
import { IndexerCredentialStore } from './indexers/indexer-credential-store';
import { IndexerKeepaliveService } from './indexers/indexer-keepalive.service';
import { IndexerOperationLock } from './indexers/indexer-operation-lock';
import { IndexerRegistry } from './indexers/indexer-registry';
import { PluginLoaderService } from './indexers/plugins/plugin-loader.service';
import { PluginInstallService } from './indexers/plugins/plugin-install.service';
import { IndexerRepository } from './indexers/indexer.repository';
import { IndexerSearchService } from './indexers/indexer-search.service';
import { TorznabAdapter } from './indexers/adapters/torznab.adapter';
import { BookRequestDownloadRepository } from './fulfillment/book-request-download.repository';
import { DirectDownloadService } from './fulfillment/direct-download.service';
import { DownloadMonitorService } from './fulfillment/download-monitor.service';
import { DownloadRemovalService } from './fulfillment/download-removal.service';
import { RequestAutomationService } from './fulfillment/request-automation.service';
import { RequestAutomationSearchDelay } from './fulfillment/request-automation-search-delay.service';
import { RequestAutomationSettingsService } from './fulfillment/request-automation-settings.service';
import { RequestFulfillmentService } from './fulfillment/request-fulfillment.service';
import { RequestImportService } from './fulfillment/request-import.service';
import { RequestSeedService } from './fulfillment/request-seed.service';
import { RequestUserCleanupService } from './fulfillment/request-user-cleanup.service';
import { RequestVerificationService } from './fulfillment/request-verification.service';
import { RequestWatchdogService } from './fulfillment/request-watchdog.service';

/**
 * The dependency on `BookDockModule` is one way and must stay that way. The dock must not learn
 * what a request is; a cycle here does not fail loudly, it hangs the TypeScript compile.
 */
@Module({
  imports: [
    LibraryModule,
    AppSettingsModule,
    AuditModule,
    BookDockModule,
    UploadModule,
    AuthModule,
    UserModule,
    forwardRef(() => NotificationModule),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [
    BookRequestController,
    BookRequestSelfFulfilController,
    BookRequestAdminController,
    BookRequestAutomationController,
    DownloadClientController,
    IndexerController,
  ],
  providers: [
    BookRequestService,
    BookRequestRepository,
    BookRequestAttributionService,
    BookRequestDedupeService,
    BookRequestNotifier,
    BookRequestGateway,
    BookRequestEventsService,
    RequestCredentialService,

    DownloadClientRepository,
    DownloadClientConfigService,
    DownloadClientRegistry,
    PathMappingService,
    QbittorrentAdapter,
    TransmissionAdapter,
    DelugeAdapter,
    {
      provide: DOWNLOAD_CLIENT_ADAPTERS,
      useFactory: (qbittorrent: QbittorrentAdapter, transmission: TransmissionAdapter, deluge: DelugeAdapter) => [qbittorrent, transmission, deluge],
      inject: [QbittorrentAdapter, TransmissionAdapter, DelugeAdapter],
    },

    IndexerRepository,
    IndexerConfigService,
    IndexerRegistry,
    PluginInstallService,
    PluginLoaderService,
    IndexerCredentialStore,
    IndexerSearchService,
    IndexerKeepaliveService,
    IndexerOperationLock,
    TorznabAdapter,
    {
      provide: INDEXER_ADAPTERS,
      useFactory: (torznab: TorznabAdapter) => [torznab],
      inject: [TorznabAdapter],
    },

    BookRequestDownloadRepository,
    DirectDownloadService,
    DownloadRemovalService,
    RequestFulfillmentService,
    RequestImportService,
    RequestVerificationService,
    RequestSeedService,
    RequestUserCleanupService,
    RequestAutomationSettingsService,
    RequestAutomationSearchDelay,
    RequestAutomationService,
    DownloadMonitorService,
    RequestWatchdogService,
  ],
  exports: [BookRequestService],
})
export class BookRequestModule {}
