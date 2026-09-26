import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ActivityCalendarQueryDto } from './dto/activity-calendar-query.dto';
import { ActivityCompletionSpeedQueryDto } from './dto/activity-completion-speed-query.dto';
import { ActivityDayQueryDto } from './dto/activity-day-query.dto';
import { ActivityPaceQueryDto } from './dto/activity-pace-query.dto';
import { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import { UserSessionTimelineQueryDto } from './dto/user-session-timeline-query.dto';
import { UpdateUserSessionTimelineSessionDto } from './dto/update-user-session-timeline-session.dto';
import { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsService } from './user-statistics.service';

@Controller('user-statistics')
export class UserStatisticsController {
  constructor(private readonly userStatisticsService: UserStatisticsService) {}

  @Get('activity-overview')
  getActivityOverview(@CurrentUser() user: RequestUser, @Query() query: UserStatisticsFilterQueryDto) {
    return this.userStatisticsService.getActivityOverview(user, query);
  }

  @Get('activity-calendar/:year')
  getActivityCalendar(@CurrentUser() user: RequestUser, @Param('year', ParseIntPipe) year: number, @Query() query: ActivityCalendarQueryDto) {
    return this.userStatisticsService.getActivityCalendar(user, year, query);
  }

  @Get('activity-days/:day')
  getActivityDay(@CurrentUser() user: RequestUser, @Param('day') day: string, @Query() query: ActivityDayQueryDto) {
    return this.userStatisticsService.getActivityDay(user, day, query);
  }

  @Get('activity-details/session-patterns')
  getActivitySessionPatterns(@CurrentUser() user: RequestUser, @Query() query: UserStatisticsFilterQueryDto) {
    return this.userStatisticsService.getActivitySessionPatterns(user, query);
  }

  @Get('activity-details/completion-speed')
  getActivityCompletionSpeed(@CurrentUser() user: RequestUser, @Query() query: ActivityCompletionSpeedQueryDto) {
    return this.userStatisticsService.getActivityCompletionSpeed(user, query);
  }

  @Get('activity-details/genre-time')
  getActivityGenreTime(@CurrentUser() user: RequestUser, @Query() query: UserStatisticsFilterQueryDto) {
    return this.userStatisticsService.getActivityGenreTime(user, query);
  }

  @Get('activity-details/pace')
  getActivityPaceDetail(@CurrentUser() user: RequestUser, @Query() query: ActivityPaceQueryDto) {
    return this.userStatisticsService.getActivityPaceDetail(user, query);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: RequestUser, @Query() query: UserStatisticsFilterQueryDto) {
    return this.userStatisticsService.getSummary(user, query);
  }

  @Get('daily-reading')
  getDailyReading(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getDailyReading(user, query);
  }

  @Get('reading-heatmap')
  getReadingHeatmap(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getReadingHeatmap(user, query);
  }

  @Get('reading-source-distribution')
  getReadingSourceDistribution(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getReadingSourceDistribution(user, query);
  }

  @Get('peak-hours')
  getPeakHours(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getPeakReadingHours(user, query);
  }

  @Get('favorite-days')
  getFavoriteDays(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getFavoriteReadingDays(user, query);
  }

  @Get('session-timeline')
  getSessionTimeline(@CurrentUser() user: RequestUser, @Query() query: UserSessionTimelineQueryDto) {
    return this.userStatisticsService.getSessionTimeline(user, query);
  }

  @Patch('session-timeline/:sessionId')
  updateSessionTimelineSession(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() dto: UpdateUserSessionTimelineSessionDto,
    @Query() query: UserStatisticsFilterQueryDto,
  ) {
    return this.userStatisticsService.updateSessionTimelineSession(user, sessionId, dto, query);
  }

  @Get('completion-timeline')
  getCompletionTimeline(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getCompletionTimeline(user, query);
  }

  @Get('goal-trajectory')
  getGoalTrajectory(@CurrentUser() user: RequestUser, @Query() query: UserGoalTrajectoryQueryDto) {
    return this.userStatisticsService.getGoalTrajectory(user, query);
  }

  @Get('progress-funnel')
  getProgressFunnel(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getProgressFunnel(user, query);
  }

  @Get('completion-latency')
  getCompletionLatency(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getCompletionLatency(user, query);
  }

  @Get('genre-reading-time')
  getGenreReadingTime(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getGenreReadingTime(user, query);
  }

  @Get('reading-pace')
  getReadingPace(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getReadingPace(user, query);
  }

  @Get('reading-survival')
  getReadingSurvival(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getReadingSurvival(user, query);
  }

  @Get('completion-race')
  getCompletionRace(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getCompletionRace(user, query);
  }

  @Get('session-archetypes')
  getSessionArchetypes(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getSessionArchetypes(user, query);
  }

  @Get('author-genre-chord')
  getAuthorGenreChord(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getAuthorGenreChord(user, query);
  }
}
