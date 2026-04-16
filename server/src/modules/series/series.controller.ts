import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListSeriesBooksDto } from './dto/list-series-books.dto';
import { ListSeriesDto } from './dto/list-series.dto';
import { SeriesService } from './series.service';

const MAX_SERIES_NAME_LENGTH = 500;

@Controller('series')
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() dto: ListSeriesDto) {
    return this.seriesService.findAll(user, dto);
  }

  @Get(':seriesName/books')
  findBooks(@CurrentUser() user: RequestUser, @Param('seriesName') rawSeriesName: string, @Query() dto: ListSeriesBooksDto) {
    const seriesName = rawSeriesName.trim();
    if (!seriesName) {
      throw new BadRequestException('seriesName must not be empty');
    }
    if (seriesName.length > MAX_SERIES_NAME_LENGTH) {
      throw new BadRequestException(`seriesName must not exceed ${MAX_SERIES_NAME_LENGTH} characters`);
    }
    return this.seriesService.findBooks(user, seriesName, dto);
  }
}
