import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../book-metadata-fetch/book-metadata-fetch.module', () => ({ BookMetadataFetchModule: class BookMetadataFetchModule {} }));
vi.mock('../path/path.module', () => ({ PathModule: class PathModule {} }));

import { BookFileUploadController } from './book-file-upload.controller';
import { UploadController } from './upload.controller';
import { UploadModule } from './upload.module';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionRepository } from './upload-session.repository';
import { UploadSessionService } from './upload-session.service';
import { FileWriteModule } from '../file-write/file-write.module';

describe('UploadModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', UploadModule)).toEqual([UploadController, BookFileUploadController, UploadSessionController]);
    expect(Reflect.getMetadata('providers', UploadModule)).toEqual([
      UploadService,
      UploadValidatorService,
      UploadStorageService,
      UploadProcessorService,
      UploadSessionRepository,
      UploadSessionService,
    ]);
    expect(Reflect.getMetadata('exports', UploadModule)).toEqual([
      UploadValidatorService,
      UploadStorageService,
      UploadProcessorService,
      UploadService,
    ]);
    expect(Reflect.getMetadata('imports', UploadModule)).toContain(FileWriteModule);
  });
});
