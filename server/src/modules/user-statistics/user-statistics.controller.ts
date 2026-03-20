import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsService } from './user-statistics.service';

@Controller('user-statistics')
export class UserStatisticsController {
  constructor(private readonly userStatisticsService: UserStatisticsService) {}

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

  @Get('peak-hours')
  getPeakHours(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getPeakReadingHours(user, query);
  }

  @Get('favorite-days')
  getFavoriteDays(@CurrentUser() user: RequestUser, @Query() query: UserDailyReadingQueryDto) {
    return this.userStatisticsService.getFavoriteReadingDays(user, query);
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
}
