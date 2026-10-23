import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookJournalController } from './book-journal.controller';
import { BookJournalModule } from './book-journal.module';
import { BookJournalRepository } from './book-journal.repository';
import { BookJournalService } from './book-journal.service';

describe('BookJournalModule', () => {
  it('registers the controller, service and repository without exporting internals', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BookJournalModule)).toEqual([BookJournalController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookJournalModule)).toEqual([BookJournalService, BookJournalRepository]);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, BookJournalModule)).toBeUndefined();
  });
});
