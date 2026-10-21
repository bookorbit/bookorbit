import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { appSettings, bookSeries } from '../../db/schema';
import { APP_SETTING_KEYS } from '../constants/app-settings.constants';
import { sanitizeLogValue } from '../utils/log-sanitize.utils';

type Db = NodePgDatabase<typeof schema>;

/**
 * Clears every series total recorded from Hardcover before it counted only released main books.
 * Its old count included novellas, split editions, box sets and announced books, so series showed
 * books as missing that do not exist yet. Stored totals only rise, so a corrected answer could
 * never replace an inflated one. The next metadata fetch records the corrected total.
 *
 * Runs once per database: the marker is written in the same transaction as the reset. A failure is
 * logged and swallowed, and the next boot tries again.
 */
@Injectable()
export class SeriesExpectedCountResetService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeriesExpectedCountResetService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'series.hardcover_total_reset';
    const startedAt = Date.now();
    try {
      const cleared = await this.clearHardcoverTotalsOnce();
      if (cleared === null) return;
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} cleared=${cleared} - Hardcover series totals cleared`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - Hardcover series total reset failed`,
      );
    }
  }

  /** Returns how many totals were cleared, or null when an earlier boot already did it. */
  async clearHardcoverTotalsOnce(): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      const [marker] = await tx
        .insert(appSettings)
        .values({ key: APP_SETTING_KEYS.SERIES_HARDCOVER_TOTALS_RESET, value: new Date().toISOString() })
        .onConflictDoNothing({ target: appSettings.key })
        .returning({ key: appSettings.key });
      if (!marker) return null;

      const rows = await tx
        .update(bookSeries)
        .set({ expectedBookCount: null, expectedBookCountSource: null, expectedBookCountUpdatedAt: new Date() })
        .where(eq(bookSeries.expectedBookCountSource, MetadataProviderKey.HARDCOVER))
        .returning({ id: bookSeries.id });
      return rows.length;
    });
  }
}
