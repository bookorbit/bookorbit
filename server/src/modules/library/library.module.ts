import { Module, forwardRef } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { ScannerModule } from '../scanner/scanner.module';
import { LibraryController } from './library.controller';
import { LibraryRepository } from './library.repository';
import { LibraryService } from './library.service';

@Module({
  imports: [ScannerModule, forwardRef(() => BookModule), FileWriteModule],
  controllers: [LibraryController],
  providers: [LibraryService, LibraryRepository],
  exports: [LibraryService, LibraryRepository],
})
export class LibraryModule {}
