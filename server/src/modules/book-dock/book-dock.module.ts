import { Module, forwardRef } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { SetupOverviewModule } from '../setup-overview/setup-overview.module';
import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NotificationModule } from '../notification/notification.module';
import { UploadModule } from '../upload/upload.module';
import { UserModule } from '../user/user.module';
import { BookDockController } from './book-dock.controller';
import { BookDockSetupFlow } from './book-dock.setup-flow';
import { BookDockDigestService } from './book-dock-digest.service';
import { BookDockDuplicateService } from './book-dock-duplicate.service';
import { BookDockEventsService } from './book-dock-events.service';
import { BookDockKeptFilesRepository } from './book-dock-kept-files.repository';
import { BookDockKeptFilesService } from './book-dock-kept-files.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockJoinService } from './book-dock-join.service';
import { BookDockMetadataService } from './book-dock-metadata.service';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { BookDockService } from './book-dock.service';
import { BookDockRepository } from './book-dock.repository';
import { LibraryDockController } from './library-dock.controller';
import { LibraryDockRegistry } from './library-dock-registry.service';
import { LibraryDockService } from './library-dock.service';
import { LibraryDockRepository } from './library-dock.repository';

@Module({
  imports: [
    SetupOverviewModule,
    UploadModule,
    AuthModule,
    BookModule,
    FileWriteModule,
    LibraryModule,
    MetadataFetchModule,
    MetadataModule,
    MetadataScoreModule,
    forwardRef(() => NotificationModule),
    AppSettingsModule,
    UserModule,
  ],
  controllers: [BookDockController, LibraryDockController],
  providers: [
    BookDockSetupFlow,
    BookDockService,
    BookDockRepository,
    LibraryDockRepository,
    LibraryDockRegistry,
    LibraryDockService,
    BookDockEventsService,
    BookDockIngestService,
    BookDockMetadataService,
    BookDockProcessingStateService,
    BookDockFinalizeService,
    BookDockJoinService,
    BookDockDuplicateService,
    BookDockDigestService,
    BookDockKeptFilesRepository,
    BookDockKeptFilesService,
    BookDockWatcherService,
    BookDockGateway,
  ],
  exports: [BookDockService, BookDockRepository, BookDockEventsService, BookDockFinalizeService, BookDockIngestService],
})
export class BookDockModule {}
