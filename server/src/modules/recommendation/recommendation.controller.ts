import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RecommendationService } from './recommendation.service';

@Controller('books')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get(':id/recommendations')
  getRecommendations(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.recommendationService.getRecommendations(id, user);
  }

  @Get(':id/series-books')
  getSeriesBooks(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.recommendationService.getSeriesBooks(id, user);
  }

  @Get(':id/author-books')
  getAuthorBooks(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.recommendationService.getAuthorBooks(id, user);
  }
}
