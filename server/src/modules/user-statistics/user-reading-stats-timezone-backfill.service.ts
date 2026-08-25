import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UserStatisticsService } from './user-statistics.service';

/**
 * Daily reading stats were aggregated in UTC before per-user timezones reached this pipeline,
 * so a row's day boundary is wherever UTC put it rather than where the reader was. An evening
 * session west of UTC landed on the following day, which starts a streak late and leaves the
 * real reading day empty.
 *
 * Correcting the setting rebuilds that history from then on, but only for someone whose zone
 * was wrong. Anyone already configured correctly has nothing left to change, and the rolling
 * aggregation only ever revisits the last couple of days, so their history would stay wrong
 * forever. This repairs it once, for everyone, from the sessions themselves.
 */
const BACKFILL_SETTING_KEY = 'reading_stats_timezone_backfill_v1';
const EVENT = 'user_statistics.timezone_backfill';

@Injectable()
export class UserReadingStatsTimeZoneBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserReadingStatsTimeZoneBackfillService.name);

  constructor(
    private readonly userStatistics: UserStatisticsService,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    // Detached: this walks every reader's whole history, and nothing it produces is needed to
    // serve a request. It contends with the hourly aggregation only through the per-library
    // advisory lock both take, and both derive the same rows from the same sessions.
    const startedAt = Date.now();
    void this.run().catch((error: unknown) => this.logFailure(error, startedAt));
  }

  async run(): Promise<{ skipped: boolean; users: number; failed: number }> {
    if (await this.appSettings.getValue(BACKFILL_SETTING_KEY)) {
      return { skipped: true, users: 0, failed: 0 };
    }

    const startedAt = Date.now();
    const userIds = await this.userStatistics.listUserIdsWithReadingHistory();
    if (userIds.length === 0) {
      await this.appSettings.setValue(BACKFILL_SETTING_KEY, new Date().toISOString());
      return { skipped: false, users: 0, failed: 0 };
    }

    this.logger.log(`[${EVENT}] [start] users=${userIds.length} - rebuilding daily reading stats in each reader's own timezone`);

    let failed = 0;
    for (const userId of userIds) {
      let timeZone = 'UTC';
      try {
        // Read here rather than with the roster: a user correcting their own timezone while
        // this walks the list would otherwise have that correct rebuild overwritten with the
        // value captured before they changed it.
        const current = await this.userStatistics.getUserTimeZone(userId);
        if (current === null) continue;
        timeZone = current;
        await this.userStatistics.rebuildDailyStatsForUser(userId, timeZone);
      } catch (error) {
        failed++;
        const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
        const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
        this.logger.warn(
          `[${EVENT}] [fail] userId=${userId} timeZone="${sanitizeLogValue(timeZone)}" errorClass=${errorClass} error="${message}" - rebuilding one reader's daily stats failed`,
        );
      }
    }

    // Marked done only on a clean pass. A partial repair that recorded itself as finished would
    // leave the users it missed with no second chance, and repeating it costs only time.
    if (failed === 0) {
      await this.appSettings.setValue(BACKFILL_SETTING_KEY, new Date().toISOString());
    }

    this.logger.log(
      `[${EVENT}] [end] durationMs=${Date.now() - startedAt} users=${userIds.length} failed=${failed} completed=${failed === 0} - daily reading stats rebuilt${failed > 0 ? ', retrying the whole pass on the next start' : ''}`,
    );

    return { skipped: false, users: userIds.length, failed };
  }

  private logFailure(error: unknown, startedAt: number): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
    this.logger.error(
      `[${EVENT}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - daily reading stats backfill failed`,
    );
  }
}
