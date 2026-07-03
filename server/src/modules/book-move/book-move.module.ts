import { Module, forwardRef } from '@nestjs/common';

import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookMoveRepository } from './book-move.repository';
import { BookMoveService } from './book-move.service';

@Module({
  imports: [forwardRef(() => LibraryModule), FileWriteModule, ScannerModule],
  providers: [BookMoveService, BookMoveRepository],
  exports: [BookMoveService],
})
export class BookMoveModule {}
