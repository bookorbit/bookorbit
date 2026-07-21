import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { NotificationModule } from '../notification/notification.module';
import { UploadModule } from '../upload/upload.module';
import { BookDockController } from './book-dock.controller';
import { BookDockEventsService } from './book-dock-events.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockMetadataService } from './book-dock-metadata.service';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { BookDockService } from './book-dock.service';
import { BookDockRepository } from './book-dock.repository';

@Module({
  imports: [
    UploadModule,
    AuthModule,
    BookModule,
    LibraryModule,
    MetadataFetchModule,
    MetadataModule,
    forwardRef(() => NotificationModule),
    AppSettingsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [BookDockController],
  providers: [
    BookDockService,
    BookDockRepository,
    BookDockEventsService,
    BookDockIngestService,
    BookDockMetadataService,
    BookDockProcessingStateService,
    BookDockFinalizeService,
    BookDockWatcherService,
    BookDockGateway,
  ],
  exports: [BookDockService, BookDockRepository],
})
export class BookDockModule {}
