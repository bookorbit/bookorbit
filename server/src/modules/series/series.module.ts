import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { LibraryModule } from '../library/library.module';
import { SeriesController } from './series.controller';
import { SeriesRepository } from './series.repository';
import { SeriesService } from './series.service';

@Module({
  imports: [BookModule, BookCoverStoreModule, LibraryModule],
  controllers: [SeriesController],
  providers: [SeriesService, SeriesRepository],
  exports: [SeriesService],
})
export class SeriesModule {}
