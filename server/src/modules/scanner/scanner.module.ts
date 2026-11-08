import { Module, forwardRef } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { AchievementModule } from '../achievement/achievement.module';
import { AuthModule } from '../auth/auth.module';
import { BookMetadataFetchModule } from '../book-metadata-fetch/book-metadata-fetch.module';
import { BookConsolidationModule } from '../book-consolidation/book-consolidation.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { MetadataModule } from '../metadata/metadata.module';
import { NotificationModule } from '../notification/notification.module';
import { FileEventProcessorService } from './file-event-processor.service';
import { FileWatcherService } from './file-watcher.service';
import { RegexMetadataReapplyService } from './regex-metadata-reapply.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerController } from './scanner.controller';
import { ScannerRepository } from './scanner.repository';
import { ScannerService } from './scanner.service';

@Module({
  imports: [
    MetadataModule,
    BookCoverStoreModule,
    AuthModule,
    AchievementModule,
    SelfWriteRegistryModule,
    CommonModule,
    forwardRef(() => NotificationModule),
    forwardRef(() => BookMetadataFetchModule),
    BookConsolidationModule,
  ],
  controllers: [ScannerController],
  providers: [
    ScannerService,
    ScannerRepository,
    ScanGateway,
    ScanJobStore,
    FileEventProcessorService,
    FileWatcherService,
    RegexMetadataReapplyService,
  ],
  exports: [ScannerService, FileWatcherService, ScanGateway],
})
export class ScannerModule {}
