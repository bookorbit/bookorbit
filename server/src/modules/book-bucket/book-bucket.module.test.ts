import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../upload/upload.module', () => ({ UploadModule: class UploadModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookBucketController } from './book-bucket.controller';
import { BookBucketEventsService } from './book-bucket-events.service';
import { BookBucketFinalizeService } from './book-bucket-finalize.service';
import { BookBucketGateway } from './book-bucket.gateway';
import { BookBucketIngestService } from './book-bucket-ingest.service';
import { BookBucketMetadataService } from './book-bucket-metadata.service';
import { BookBucketModule } from './book-bucket.module';
import { BookBucketRepository } from './book-bucket.repository';
import { BookBucketService } from './book-bucket.service';
import { BookBucketWatcherService } from './book-bucket-watcher.service';

describe('BookBucketModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BookBucketModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookBucketModule) as Array<unknown>;

    expect(controllers).toEqual([BookBucketController]);
    expect(providers).toEqual(
      expect.arrayContaining([
        BookBucketService,
        BookBucketRepository,
        BookBucketEventsService,
        BookBucketIngestService,
        BookBucketMetadataService,
        BookBucketFinalizeService,
        BookBucketWatcherService,
        BookBucketGateway,
      ]),
    );
  });
});
