import { Module } from '@nestjs/common';

import { LibraryModule } from '../library/library.module';
import { BookDuplicatesController } from './book-duplicates.controller';
import { BookDuplicatesRepository } from './book-duplicates.repository';
import { BookDuplicatesService } from './book-duplicates.service';

@Module({
  imports: [LibraryModule],
  controllers: [BookDuplicatesController],
  providers: [BookDuplicatesService, BookDuplicatesRepository],
})
export class BookDuplicatesModule {}
