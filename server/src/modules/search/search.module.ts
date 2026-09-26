import { Module } from '@nestjs/common';

import { AuthorsModule } from '../authors/authors.module';
import { BookModule } from '../book/book.module';
import { SeriesModule } from '../series/series.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [BookModule, AuthorsModule, SeriesModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
