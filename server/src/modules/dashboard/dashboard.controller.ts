import { Controller, DefaultValuePipe, Get, Param, ParseEnumPipe, ParseIntPipe, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { ScrollerType } from './dto/scroller-type.enum';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('scrollers/:type')
  getScroller(
    @Param('type', new ParseEnumPipe(ScrollerType)) type: ScrollerType,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('lensId', new DefaultValuePipe(0), ParseIntPipe) lensId: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dashboardService.getScroller(type, user, limit, lensId);
  }
}
