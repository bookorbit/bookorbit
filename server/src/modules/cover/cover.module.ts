import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { CoverController } from './cover.controller';
import { CoverService } from './cover.service';
import { DuckDuckGoCoverProvider } from './providers/duckduckgo-cover-provider';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [CoverController],
  providers: [CoverService, DuckDuckGoCoverProvider],
  exports: [CoverService],
})
export class CoverModule {}
