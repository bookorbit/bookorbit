import { Module } from '@nestjs/common';

import { BookModule } from '../../book/book.module';
import { KoboModule } from '../../kobo/kobo.module';
import { LibraryModule } from '../../library/library.module';
import { EpubController } from './epub.controller';
import { EpubService } from './epub.service';

@Module({
  imports: [BookModule, LibraryModule, KoboModule],
  controllers: [EpubController],
  providers: [EpubService],
})
export class EpubModule {}
