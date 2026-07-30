import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { BookmarkController } from './bookmark.controller';
import { BookmarkRepository } from './bookmark.repository';
import { BookmarkService } from './bookmark.service';
import { BookmarkSyncService } from './bookmark-sync.service';

@Module({
  imports: [BookModule],
  controllers: [BookmarkController],
  providers: [BookmarkService, BookmarkSyncService, BookmarkRepository],
  exports: [BookmarkSyncService],
})
export class BookmarkModule {}
