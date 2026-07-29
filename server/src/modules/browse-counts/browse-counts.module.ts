import { Module } from '@nestjs/common';

import { AnnotationModule } from '../annotation/annotation.module';
import { AuthorsModule } from '../authors/authors.module';
import { SeriesModule } from '../series/series.module';
import { BrowseCountsController } from './browse-counts.controller';
import { BrowseCountsService } from './browse-counts.service';

@Module({
  imports: [AuthorsModule, SeriesModule, AnnotationModule],
  controllers: [BrowseCountsController],
  providers: [BrowseCountsService],
})
export class BrowseCountsModule {}
