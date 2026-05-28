import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../scanner/scanner.module', () => ({ ScannerModule: class ScannerModule {} }));
vi.mock('../achievement/achievement.module', () => ({ AchievementModule: class AchievementModule {} }));
vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../notification/notification.module', () => ({ NotificationModule: class NotificationModule {} }));

import { LibraryController } from './library.controller';
import { LibraryModule } from './library.module';
import { LibraryRepository } from './library.repository';
import { LibraryService } from './library.service';
import { BulkRenameService } from './bulk-rename.service';

describe('LibraryModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', LibraryModule)).toEqual([LibraryController]);
    expect(Reflect.getMetadata('providers', LibraryModule)).toEqual([LibraryService, LibraryRepository, BulkRenameService]);
    expect(Reflect.getMetadata('exports', LibraryModule)).toEqual([LibraryService, LibraryRepository]);
  });
});
