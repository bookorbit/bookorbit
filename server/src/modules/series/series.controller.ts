import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListSeriesBooksDto } from './dto/list-series-books.dto';
import { ListSeriesDto } from './dto/list-series.dto';
import { SeriesService } from './series.service';

@Controller('series')
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() dto: ListSeriesDto) {
    return this.seriesService.findAll(user, dto);
  }

  @Get(':seriesId/books')
  findBooks(@CurrentUser() user: RequestUser, @Param('seriesId', ParseIntPipe) seriesId: number, @Query() dto: ListSeriesBooksDto) {
    return this.seriesService.findBooks(user, seriesId, dto);
  }
}
