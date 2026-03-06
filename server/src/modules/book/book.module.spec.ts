import 'reflect-metadata';

jest.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
jest.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));
jest.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
jest.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
jest.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
jest.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));

import { BookQueryBuilder } from './book-query-builder.service';
import { BookController } from './book.controller';
import { BookModule } from './book.module';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';

describe('BookModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', BookModule)).toEqual([BookController]);
    expect(Reflect.getMetadata('providers', BookModule)).toEqual([BookService, BookRepository, BookQueryBuilder]);
    expect(Reflect.getMetadata('exports', BookModule)).toEqual([BookService, BookRepository, BookQueryBuilder]);
  });
});
