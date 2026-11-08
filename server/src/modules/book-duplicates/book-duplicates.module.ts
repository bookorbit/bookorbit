import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { BookLinkModule } from '../book-link/book-link.module';
import { BookMergeModule } from '../book-merge/book-merge.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookDuplicateResolutionRepository } from './book-duplicate-resolution.repository';
import { BookDuplicateResolutionService } from './book-duplicate-resolution.service';
import { BookDuplicatesController } from './book-duplicates.controller';
import { BookDuplicatesRepository } from './book-duplicates.repository';
import { BookDuplicatesService } from './book-duplicates.service';

@Module({
  imports: [LibraryModule, CommonModule, AuditModule, BookModule, BookMergeModule, BookLinkModule, ScannerModule],
  controllers: [BookDuplicatesController],
  providers: [BookDuplicatesService, BookDuplicatesRepository, BookDuplicateResolutionService, BookDuplicateResolutionRepository],
})
export class BookDuplicatesModule {}
