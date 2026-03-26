import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { UserStatisticsService } from './user-statistics.service';

@Injectable()
export class UserStatisticsAggregationJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserStatisticsAggregationJob.name);

  constructor(private readonly userStatisticsService: UserStatisticsService) {}

  async onApplicationBootstrap() {
    await this.recomputeRecent();
  }

  @Cron('15 * * * *')
  async runHourlyAggregation() {
    await this.recomputeRecent();
  }

  private async recomputeRecent() {
    try {
      const result = await this.userStatisticsService.recomputeRecentDailyStats(2);
      if (result.deleted > 0 || result.inserted > 0) {
        this.logger.log(`User daily stats recomputed from ${result.since}: deleted=${result.deleted}, inserted=${result.inserted}`);
      }
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
      const stack = err instanceof Error ? err.stack : String(err);
      this.logger.error(`User daily stats aggregation failed${cause ? `: ${cause}` : ''}`, stack);
    }
  }
}
