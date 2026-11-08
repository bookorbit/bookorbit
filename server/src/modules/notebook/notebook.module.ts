import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { LibraryModule } from '../library/library.module';
import { NotebookController } from './notebook.controller';
import { NotebookRepository } from './notebook.repository';
import { NotebookService } from './notebook.service';

@Module({
  imports: [LibraryModule, BookCoverStoreModule, AppAttestModule],
  controllers: [NotebookController],
  providers: [NotebookService, NotebookRepository],
})
export class NotebookModule {}
