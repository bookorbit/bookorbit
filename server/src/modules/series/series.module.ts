import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { SeriesController } from './series.controller';
import { SeriesRepository } from './series.repository';
import { SeriesService } from './series.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [SeriesController],
  providers: [SeriesService, SeriesRepository],
})
export class SeriesModule {}
