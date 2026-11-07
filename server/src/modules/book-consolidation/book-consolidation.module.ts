import { Module } from '@nestjs/common';

import { BookConsolidationRepository } from './book-consolidation.repository';
import { BookConsolidationService } from './book-consolidation.service';

/** Imports no feature module, so file-write, book-move, the scanner and book-merge can all use it. */
@Module({
  providers: [BookConsolidationRepository, BookConsolidationService],
  exports: [BookConsolidationService],
})
export class BookConsolidationModule {}
