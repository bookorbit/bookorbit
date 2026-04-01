import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { BookmarkController } from './bookmark.controller';
import { BookmarkRepository } from './bookmark.repository';
import { BookmarkService } from './bookmark.service';

@Module({
  imports: [BookModule],
  controllers: [BookmarkController],
  providers: [BookmarkService, BookmarkRepository],
})
export class BookmarkModule {}
