import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { Locale } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestLocale } from '../../common/decorators/request-locale.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { DashboardWidgetService } from './dashboard-widget.service';
import { DashboardScrollerBatchDto } from './dto/dashboard-scroller-batch.dto';
import { DashboardWidgetBatchDto } from './dto/dashboard-widget-batch.dto';
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

  @Post('scrollers/batch')
  @HttpCode(HttpStatus.OK)
  getScrollers(@CurrentUser() user: RequestUser, @Body() dto: DashboardScrollerBatchDto) {
    return this.dashboardService.getScrollers(dto, user);
  }

  @Post('widgets/batch')
  @HttpCode(HttpStatus.OK)
  @Header('Vary', 'Accept-Language')
  getWidgets(@CurrentUser() user: RequestUser, @Body() dto: DashboardWidgetBatchDto, @RequestLocale() locale: Locale) {
    return this.widgetService.getWidgets([...new Set(dto.widgets)], user, locale);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  refresh(@CurrentUser() user: RequestUser) {
    this.widgetService.clearCacheForUser(user.id);
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

  @Get('widgets/highlights')
  getHighlights(@CurrentUser() user: RequestUser) {
    return this.widgetService.getHighlights(user);
  }

  @Get('widgets/monthly-challenge')
  @Header('Vary', 'Accept-Language')
  getMonthlyChallenge(@CurrentUser() user: RequestUser, @RequestLocale() locale: Locale) {
    return this.widgetService.getMonthlyChallenge(user, locale);
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
