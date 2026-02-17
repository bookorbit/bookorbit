import { Module, forwardRef } from '@nestjs/common';

import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookController } from './book.controller';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';

@Module({
  imports: [forwardRef(() => LibraryModule), MetadataModule],
  controllers: [BookController],
  providers: [BookService, BookRepository, BookQueryBuilder],
  exports: [BookService, BookRepository, BookQueryBuilder],
})
export class BookModule {}
