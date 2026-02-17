import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { CoverController } from './cover.controller';
import { CoverService } from './cover.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [CoverController],
  providers: [CoverService],
  exports: [CoverService],
})
export class CoverModule {}
