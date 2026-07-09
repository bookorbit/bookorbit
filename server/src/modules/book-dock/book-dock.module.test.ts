import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../upload/upload.module', () => ({ UploadModule: class UploadModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookDockController } from './book-dock.controller';
import { BookDockEventsService } from './book-dock-events.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockGateway } from './book-dock.gateway';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockMetadataService } from './book-dock-metadata.service';
import { BookDockModule } from './book-dock.module';
import { BookDockProcessingStateService } from './book-dock-processing-state.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockService } from './book-dock.service';
import { BookDockWatcherService } from './book-dock-watcher.service';

describe('BookDockModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BookDockModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookDockModule) as Array<unknown>;

    expect(controllers).toEqual([BookDockController]);
    expect(providers).toEqual(
      expect.arrayContaining([
        BookDockService,
        BookDockRepository,
        BookDockEventsService,
        BookDockIngestService,
        BookDockMetadataService,
        BookDockProcessingStateService,
        BookDockFinalizeService,
        BookDockWatcherService,
        BookDockGateway,
      ]),
    );
  });
});
