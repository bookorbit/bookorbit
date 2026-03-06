import 'reflect-metadata';

jest.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
jest.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
jest.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));

import { UploadController } from './upload.controller';
import { UploadModule } from './upload.module';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';

describe('UploadModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', UploadModule)).toEqual([UploadController]);
    expect(Reflect.getMetadata('providers', UploadModule)).toEqual([
      UploadService,
      UploadValidatorService,
      UploadStorageService,
      UploadProcessorService,
    ]);
    expect(Reflect.getMetadata('exports', UploadModule)).toEqual([UploadValidatorService, UploadStorageService, UploadProcessorService]);
  });
});
