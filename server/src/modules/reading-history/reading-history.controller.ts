import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingHistoryPeriodQueryDto, ReadingHistoryQueryDto, UpdateReadRatingDto } from './dto/reading-history-query.dto';
import { ReadingHistoryService } from './reading-history.service';

/** A reader's own finished reads. Everything here is scoped to the signed-in user. */
@Controller('reading-history')
export class ReadingHistoryController {
  constructor(private readonly service: ReadingHistoryService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ReadingHistoryQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: RequestUser, @Query() query: ReadingHistoryPeriodQueryDto) {
    return this.service.summary(user, query);
  }

  @Get(':attemptId/marks')
  marks(@CurrentUser() user: RequestUser, @Param('attemptId', ParseIntPipe) attemptId: number) {
    return this.service.marks(user, attemptId);
  }

  @Patch(':attemptId/rating')
  setRating(@CurrentUser() user: RequestUser, @Param('attemptId', ParseIntPipe) attemptId: number, @Body() dto: UpdateReadRatingDto) {
    return this.service.setRating(user, attemptId, dto.rating);
  }
}
