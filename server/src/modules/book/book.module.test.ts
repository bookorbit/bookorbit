import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));
vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));

import { BookQueryBuilder } from './book-query-builder.service';
import { BookController } from './book.controller';
import { BookModule } from './book.module';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';
import { ComicMetadataService } from './comic-metadata.service';

describe('BookModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', BookModule)).toEqual([BookController]);
    expect(Reflect.getMetadata('providers', BookModule)).toEqual([BookService, BookRepository, BookQueryBuilder, ComicMetadataService]);
    expect(Reflect.getMetadata('exports', BookModule)).toEqual([BookService, BookRepository, BookQueryBuilder]);
  });
});
