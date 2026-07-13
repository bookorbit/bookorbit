import { Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SharedReadingInsightsQueryDto } from './dto/shared-reading-insights.dto';
import { SharedReadingInsightsService } from './shared-reading-insights.service';

@Controller('shared-reading-insights')
@RequirePermission(Permission.ViewUserActivity)
export class SharedReadingInsightsController {
  constructor(private readonly service: SharedReadingInsightsService) {}

  @Post(':userId/view-sessions')
  createViewSession(@CurrentUser() viewer: RequestUser, @Param('userId', ParseIntPipe) userId: number) {
    return this.service.createViewSession(viewer, userId);
  }

  @Get(':userId/summary')
  getSummary(
    @CurrentUser() viewer: RequestUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Headers('x-reading-insights-view-session') viewSessionId: string | undefined,
    @Query() query: SharedReadingInsightsQueryDto,
  ) {
    return this.service.getSharedSummary(viewer, userId, viewSessionId, query.days);
  }

  @Get(':userId/detailed')
  getDetailed(
    @CurrentUser() viewer: RequestUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Headers('x-reading-insights-view-session') viewSessionId: string | undefined,
    @Query() query: SharedReadingInsightsQueryDto,
  ) {
    return this.service.getSharedDetail(viewer, userId, viewSessionId, query.days);
  }
}
