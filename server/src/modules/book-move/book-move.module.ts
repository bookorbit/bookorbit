import { Module, forwardRef } from '@nestjs/common';

import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookMoveRepository } from './book-move.repository';
import { BookMoveService } from './book-move.service';

@Module({
  imports: [forwardRef(() => LibraryModule), FileWriteModule, ScannerModule, SelfWriteRegistryModule],
  providers: [BookMoveService, BookMoveRepository],
  exports: [BookMoveService],
})
export class BookMoveModule {}
