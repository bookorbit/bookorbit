import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { BookJournalController } from './book-journal.controller';
import { BookJournalRepository } from './book-journal.repository';
import { BookJournalService } from './book-journal.service';

@Module({
  imports: [BookModule],
  controllers: [BookJournalController],
  providers: [BookJournalService, BookJournalRepository],
})
export class BookJournalModule {}
