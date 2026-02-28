import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuthModule } from '../auth/auth.module';
import { LibraryModule } from '../library/library.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { UploadModule } from '../upload/upload.module';
import { StagingController } from './staging.controller';
import { StagingEventsService } from './staging-events.service';
import { StagingFinalizeService } from './staging-finalize.service';
import { StagingGateway } from './staging.gateway';
import { StagingIngestService } from './staging-ingest.service';
import { StagingMetadataService } from './staging-metadata.service';
import { StagingWatcherService } from './staging-watcher.service';
import { StagingService } from './staging.service';
import { StagingRepository } from './staging.repository';

@Module({
  imports: [
    UploadModule,
    AuthModule,
    LibraryModule,
    MetadataFetchModule,
    MetadataModule,
    AppSettingsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.get<string>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [StagingController],
  providers: [
    StagingService,
    StagingRepository,
    StagingEventsService,
    StagingIngestService,
    StagingMetadataService,
    StagingFinalizeService,
    StagingWatcherService,
    StagingGateway,
  ],
  exports: [StagingService, StagingRepository],
})
export class StagingModule {}
