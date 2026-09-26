import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { BookMetadataFetchModule } from '../book-metadata-fetch/book-metadata-fetch.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { PathModule } from '../path/path.module';
import { BookFileUploadController } from './book-file-upload.controller';
import { UploadController } from './upload.controller';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionRepository } from './upload-session.repository';
import { UploadSessionService } from './upload-session.service';

@Module({
  imports: [AppSettingsModule, BookCoverStoreModule, LibraryModule, MetadataModule, BookMetadataFetchModule, FileWriteModule, PathModule],
  controllers: [UploadController, BookFileUploadController, UploadSessionController],
  providers: [UploadService, UploadValidatorService, UploadStorageService, UploadProcessorService, UploadSessionRepository, UploadSessionService],
  exports: [UploadValidatorService, UploadStorageService, UploadProcessorService, UploadService],
})
export class UploadModule {}
