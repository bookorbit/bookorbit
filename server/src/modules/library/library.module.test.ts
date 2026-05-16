import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../scanner/scanner.module', () => ({ ScannerModule: class ScannerModule {} }));
vi.mock('../achievement/achievement.module', () => ({ AchievementModule: class AchievementModule {} }));

import { LibraryController } from './library.controller';
import { LibraryModule } from './library.module';
import { LibraryRepository } from './library.repository';
import { LibraryService } from './library.service';

describe('LibraryModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', LibraryModule)).toEqual([LibraryController]);
    expect(Reflect.getMetadata('providers', LibraryModule)).toEqual([LibraryService, LibraryRepository]);
    expect(Reflect.getMetadata('exports', LibraryModule)).toEqual([LibraryService, LibraryRepository]);
  });
});
