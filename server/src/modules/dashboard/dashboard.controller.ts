import { Controller, DefaultValuePipe, Get, Param, ParseEnumPipe, ParseIntPipe, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { DashboardWidgetService } from './dashboard-widget.service';
import { ScrollerType } from './dto/scroller-type.enum';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetService: DashboardWidgetService,
  ) {}

  @Get('scrollers/:type')
  getScroller(
    @Param('type', new ParseEnumPipe(ScrollerType)) type: ScrollerType,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('smartScopeId', new DefaultValuePipe(0), ParseIntPipe) smartScopeId: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dashboardService.getScroller(type, user, limit, smartScopeId);
  }

  @Get('widgets/reading-goal')
  getReadingGoal(@CurrentUser() user: RequestUser) {
    return this.widgetService.getReadingGoal(user);
  }

  @Get('widgets/currently-reading')
  getCurrentlyReading(@CurrentUser() user: RequestUser) {
    return this.widgetService.getCurrentlyReading(user);
  }

  @Get('widgets/reading-streak')
  getReadingStreak(@CurrentUser() user: RequestUser) {
    return this.widgetService.getReadingStreak(user);
  }

  @Get('widgets/library-overview')
  getLibraryOverview(@CurrentUser() user: RequestUser) {
    return this.widgetService.getLibraryOverview(user);
  }

  @Get('widgets/highlight-of-the-day')
  getHighlightOfTheDay(@CurrentUser() user: RequestUser) {
    return this.widgetService.getHighlightOfTheDay(user);
  }

  @Get('widgets/monthly-challenge')
  getMonthlyChallenge(@CurrentUser() user: RequestUser) {
    return this.widgetService.getMonthlyChallenge(user);
  }

  @Get('widgets/year-projection')
  getYearProjection(@CurrentUser() user: RequestUser) {
    return this.widgetService.getYearProjection(user);
  }

  @Get('widgets/neglected-gems')
  getNeglectedGems(@CurrentUser() user: RequestUser) {
    return this.widgetService.getNeglectedGems(user);
  }

  @Get('widgets/reading-dna')
  getReadingDna(@CurrentUser() user: RequestUser) {
    return this.widgetService.getReadingDna(user);
  }

  @Get('widgets/long-wait')
  getLongWait(@CurrentUser() user: RequestUser) {
    return this.widgetService.getLongWait(user);
  }

  @Get('widgets/diversity-score')
  getDiversityScore(@CurrentUser() user: RequestUser) {
    return this.widgetService.getDiversityScore(user);
  }

  @Get('widgets/reading-rhythm')
  getReadingRhythm(@CurrentUser() user: RequestUser) {
    return this.widgetService.getReadingRhythm(user);
  }
}
