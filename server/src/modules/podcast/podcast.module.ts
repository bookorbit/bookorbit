import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { APP_FEATURES } from '@bookorbit/types';

import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { AuthModule } from '../auth/auth.module';
import { LibraryModule } from '../library/library.module';
import { NotificationModule } from '../notification/notification.module';
import {
  PodcastBookmarkController,
  PodcastController,
  PodcastDownloadBatchController,
  PodcastEpisodeController,
  PodcastEventsController,
  PodcastLibraryController,
  PodcastQueueController,
  PodcastSearchController,
} from './podcast.controller';
import { PodcastArtworkService } from './podcast-artwork.service';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastCatalogService } from './podcast-catalog.service';
import { PodcastDirectoryService } from './podcast-directory.service';
import { PodcastEventsService } from './podcast-events.service';
import { PodcastFeedClientService } from './podcast-feed-client.service';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import { PodcastFeedSnapshotService } from './podcast-feed-snapshot.service';
import { PodcastGateway } from './podcast.gateway';
import { PodcastFileImportService } from './podcast-file-import.service';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import { PodcastLocalWatcherService } from './podcast-local-watcher.service';
import { PodcastMediaStorageService } from './podcast-media-storage.service';
import { PodcastOpmlService } from './podcast-opml.service';
import { PodcastOperationsService } from './podcast-operations.service';
import { PodcastPlaybackService } from './podcast-playback.service';
import { PodcastTagReaderService } from './podcast-tag-reader.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastPlaybackRepository } from './podcast-playback.repository';
import { PodcastSecretService } from './podcast-secret.service';
import { PodcastSidecarService } from './podcast-sidecar.service';
import { PodcastStreamAuthGuard } from './podcast-stream-auth.guard';
import { PodcastStreamTicketService } from './podcast-stream-ticket.service';
import { PodcastUrlSecurityService } from './podcast-url-security.service';
import { PodcastWorkerService } from './podcast-worker.service';

const PODCAST_CONTROLLERS = APP_FEATURES.podcasts
  ? [
      PodcastLibraryController,
      PodcastSearchController,
      PodcastController,
      PodcastDownloadBatchController,
      PodcastEpisodeController,
      PodcastEventsController,
      PodcastQueueController,
      PodcastBookmarkController,
    ]
  : [];

const PODCAST_RUNTIME_PROVIDERS = APP_FEATURES.podcasts
  ? [
      PodcastCatalogService,
      PodcastPlaybackService,
      PodcastOperationsService,
      PodcastJobRepository,
      PodcastFeedClientService,
      PodcastFeedSnapshotService,
      PodcastDirectoryService,
      PodcastOpmlService,
      PodcastTagReaderService,
      PodcastFileImportService,
      PodcastLocalShowImportService,
      PodcastLocalWatcherService,
      PodcastSidecarService,
      PodcastArtworkService,
      PodcastMediaStorageService,
      PodcastStreamTicketService,
      PodcastStreamAuthGuard,
      PodcastUrlSecurityService,
      PodcastEventsService,
      PodcastGateway,
      PodcastWorkerService,
    ]
  : [];

@Module({
  imports: [
    AuthModule,
    LibraryModule,
    NotificationModule,
    SelfWriteRegistryModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: PODCAST_CONTROLLERS,
  providers: [
    PodcastCatalogRepository,
    PodcastEpisodeRepository,
    PodcastPlaybackRepository,
    PodcastAccessService,
    PodcastFeedParserService,
    PodcastSecretService,
    ...PODCAST_RUNTIME_PROVIDERS,
  ],
  /** Podcast smart scopes and collections live in their own modules but evaluate against these. */
  exports: [PodcastEpisodeRepository, PodcastAccessService, PodcastCatalogRepository],
})
export class PodcastModule {}
