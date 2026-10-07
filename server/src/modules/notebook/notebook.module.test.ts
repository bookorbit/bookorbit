import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { LibraryModule } from '../library/library.module';
import { NotebookController } from './notebook.controller';
import { NotebookModule } from './notebook.module';
import { NotebookRepository } from './notebook.repository';
import { NotebookService } from './notebook.service';

describe('NotebookModule', () => {
  it('registers its controller and providers and imports library access and covers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, NotebookModule)).toEqual(expect.arrayContaining([LibraryModule, BookCoverStoreModule]));
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, NotebookModule)).toEqual([NotebookController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, NotebookModule)).toEqual(expect.arrayContaining([NotebookService, NotebookRepository]));
  });
});
