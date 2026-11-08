import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookLinkController } from './book-link.controller';
import { BookLinkRepository } from './book-link.repository';
import { BookLinkService } from './book-link.service';

@Module({
  imports: [BookModule, ScannerModule],
  controllers: [BookLinkController],
  providers: [BookLinkService, BookLinkRepository],
  exports: [BookLinkService],
})
export class BookLinkModule {}
