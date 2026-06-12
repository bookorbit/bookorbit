import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));
vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { LibraryModule } from '../library/library.module';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookReadService } from './book-read.service';
import { BookSortBuilder } from './book-sort-builder.service';
import { BookController } from './book.controller';
import { BookModule } from './book.module';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';
import { BookAuthorSortKeyBackfillService } from './book-author-sort-key-backfill.service';

describe('BookModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', BookModule)).toEqual([BookController]);
    expect(Reflect.getMetadata('providers', BookModule)).toEqual([
      BookService,
      BookRepository,
      BookReadService,
      BookSortBuilder,
      BookQueryBuilder,
      BookAuthorSortKeyBackfillService,
    ]);
    expect(Reflect.getMetadata('exports', BookModule)).toEqual([BookService, BookReadService, BookQueryBuilder]);
  });

  it('keeps library module in forwardRef imports', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, BookModule) as Array<{ forwardRef?: () => unknown }>;
    const forwardRefImport = imports.find((entry) => typeof entry?.forwardRef === 'function');

    expect(forwardRefImport).toBeDefined();
    expect(forwardRefImport?.forwardRef?.()).toBe(LibraryModule);
  });
});
