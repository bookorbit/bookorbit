import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { UploadController } from './upload.controller';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';

@Module({
  imports: [AppSettingsModule, LibraryModule, MetadataModule],
  controllers: [UploadController],
  providers: [UploadService, UploadValidatorService, UploadStorageService, UploadProcessorService],
})
export class UploadModule {}
