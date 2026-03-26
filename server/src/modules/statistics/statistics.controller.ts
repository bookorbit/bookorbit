import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BooksOverTimeQueryDto } from './dto/books-over-time-query.dto';
import { StatisticsFilterQueryDto } from './dto/statistics-filter-query.dto';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('format-distribution')
  getFormatDistribution(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getFormatDistribution(user, query);
  }

  @Get('language-distribution')
  getLanguageDistribution(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getLanguageDistribution(user, query);
  }

  @Get('books-added-over-time')
  getBooksAddedOverTime(@CurrentUser() user: RequestUser, @Query() query: BooksOverTimeQueryDto) {
    return this.statisticsService.getBooksAddedOverTime(user, query);
  }

  @Get('storage-by-format')
  getStorageByFormat(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getStorageByFormat(user, query);
  }

  @Get('metadata-score-distribution')
  getMetadataScoreDistribution(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getMetadataScoreDistribution(user, query);
  }

  @Get('library-metadata-completeness')
  getLibraryMetadataCompleteness(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getLibraryMetadataCompleteness(user, query);
  }

  @Get('format-share-over-time')
  getFormatShareOverTime(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getFormatShareOverTime(user, query);
  }

  @Get('genre-rank-over-time')
  getGenreRankOverTime(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getGenreRankOverTime(user, query);
  }

  @Get('page-count-distribution')
  getPageCountDistribution(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getPageCountDistribution(user, query);
  }

  @Get('publication-decade')
  getPublicationDecade(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getPublicationDecade(user, query);
  }

  @Get('top-authors')
  getTopAuthors(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getTopAuthors(user, query);
  }

  @Get('metadata-completeness')
  getMetadataCompleteness(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getMetadataCompleteness(user, query);
  }

  @Get('genre-distribution')
  getGenreDistribution(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getGenreDistribution(user, query);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getSummary(user, query);
  }

  @Get('genre-cooccurrence')
  getGenreCooccurrence(@CurrentUser() user: RequestUser, @Query() query: StatisticsFilterQueryDto) {
    return this.statisticsService.getGenreCooccurrence(user, query);
  }
}
