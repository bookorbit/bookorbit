import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';

import type { YearReviewResponse } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { YearReviewService } from './year-review.service';

@Controller('mobile/year-review')
@RequireAppAttest()
export class YearReviewController {
  constructor(private readonly yearReview: YearReviewService) {}

  @Get(':year')
  getYear(@Param('year', ParseIntPipe) year: number, @CurrentUser() user: RequestUser): Promise<YearReviewResponse> {
    return this.yearReview.getYear(user, year);
  }
}
