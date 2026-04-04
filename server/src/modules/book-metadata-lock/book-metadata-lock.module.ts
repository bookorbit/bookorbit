import { Module } from '@nestjs/common';

import { BookMetadataLockRepository } from './book-metadata-lock.repository';
import { BookMetadataLockService } from './book-metadata-lock.service';

@Module({
  providers: [BookMetadataLockRepository, BookMetadataLockService],
  exports: [BookMetadataLockService],
})
export class BookMetadataLockModule {}
