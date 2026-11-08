import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { BookJournalController } from './book-journal.controller';
import { BookJournalRepository } from './book-journal.repository';
import { BookJournalService } from './book-journal.service';

@Module({
  imports: [AppAttestModule, BookModule],
  controllers: [BookJournalController],
  providers: [BookJournalService, BookJournalRepository],
})
export class BookJournalModule {}
