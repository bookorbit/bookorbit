import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuthModule } from '../auth/auth.module';
import { LibraryModule } from '../library/library.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { UploadModule } from '../upload/upload.module';
import { BookBucketController } from './book-bucket.controller';
import { BookBucketEventsService } from './book-bucket-events.service';
import { BookBucketFinalizeService } from './book-bucket-finalize.service';
import { BookBucketGateway } from './book-bucket.gateway';
import { BookBucketIngestService } from './book-bucket-ingest.service';
import { BookBucketMetadataService } from './book-bucket-metadata.service';
import { BookBucketWatcherService } from './book-bucket-watcher.service';
import { BookBucketService } from './book-bucket.service';
import { BookBucketRepository } from './book-bucket.repository';

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
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [BookBucketController],
  providers: [
    BookBucketService,
    BookBucketRepository,
    BookBucketEventsService,
    BookBucketIngestService,
    BookBucketMetadataService,
    BookBucketFinalizeService,
    BookBucketWatcherService,
    BookBucketGateway,
  ],
  exports: [BookBucketService, BookBucketRepository],
})
export class BookBucketModule {}
