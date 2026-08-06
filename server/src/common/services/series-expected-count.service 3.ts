import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { MetadataCandidate } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookSeries } from '../../db/schema';
import { sanitizeLogValue } from '../utils/log-sanitize.utils';
import { normalizeSeriesTotalBooks } from '../utils/series-total-books.utils';
import { SeriesIdentityService } from './series-identity.service';

type Db = NodePgDatabase<typeof schema>;
type ExpectedCountExecutor = Pick<Db, 'select' | 'update'>;

type PendingCount = {
  displayName: string;
  total: number;
  provider: string;
};

type CountEntry = {
  seriesName: string | null | undefined;
  totalBooks: unknown;
  source: string;
};

/** Source marker for a total the file declared itself, as opposed to a metadata provider. */
export const EMBEDDED_SERIES_TOTAL_SOURCE = 'embedded';

/** Source marker for a total a person typed in the metadata editor. */
export const MANUAL_SERIES_TOTAL_SOURCE = 'manual';

@Injectable()
export class SeriesExpectedCountService {
  private readonly logger = new Logger(SeriesExpectedCountService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly seriesIdentity: SeriesIdentityService,
  ) {}

  /**
   * Records how many books each provider believes a series holds. Only annotates series that
   * already exist locally, so browsing metadata for a series nobody owns never creates a row.
   *
   * Never throws: a series total is ancillary to the metadata refresh that produced it, and
   * failing to store one must not fail the refresh.
   */
  async recordFromCandidates(candidates: readonly MetadataCandidate[], executor: ExpectedCountExecutor = this.db): Promise<number> {
    return this.recordEntries(
      candidates.map((candidate) => ({ seriesName: candidate.seriesName, totalBooks: candidate.seriesTotalBooks, source: candidate.provider })),
      executor,
    );
  }

  /**
   * Records a total a book file declared about its own series, as ComicInfo.xml Count does.
   * Shares every rule with the provider path: never creates an unowned series, and only raises
   * the stored total, so scanning a series whose files disagree settles on the same answer
   * whatever order the files happen to be read in.
   */
  async record(
    seriesName: string | null | undefined,
    totalBooks: unknown,
    source: string = EMBEDDED_SERIES_TOTAL_SOURCE,
    executor: ExpectedCountExecutor = this.db,
  ): Promise<number> {
    return this.recordEntries([{ seriesName, totalBooks, source }], executor);
  }

  /**
   * Applies a total a person typed in the metadata editor. Three things separate it from the
   * automated paths: null clears the value, a smaller total still wins because the person is
   * stating the length outright, and failures propagate so a save cannot silently do nothing.
   *
   * The row is shared, so this changes the total every user sees for the series.
   */
  async setManual(
    seriesName: string | null | undefined,
    expectedBookCount: number | null,
    executor: ExpectedCountExecutor = this.db,
  ): Promise<boolean> {
    const displayName = this.seriesIdentity.normalizeDisplayName(seriesName);
    if (!displayName) return false;

    const seriesId = await this.seriesIdentity.findIdByName(displayName, executor);
    if (seriesId == null) return false;

    const total = expectedBookCount === null ? null : (normalizeSeriesTotalBooks(expectedBookCount) ?? null);
    await executor
      .update(bookSeries)
      .set({
        expectedBookCount: total,
        expectedBookCountSource: total === null ? null : MANUAL_SERIES_TOTAL_SOURCE,
        expectedBookCountUpdatedAt: new Date(),
      })
      .where(eq(bookSeries.id, seriesId));

    return true;
  }

  private async recordEntries(entries: readonly CountEntry[], executor: ExpectedCountExecutor): Promise<number> {
    try {
      return await this.applyEntries(entries, executor);
    } catch (err) {
      const e = err as Error;
      this.logger.warn(
        `[series.expectedCount] [fail] errorClass=${e.name} error="${sanitizeLogValue(e.message)}" - could not record series totals; metadata refresh unaffected`,
      );
      return 0;
    }
  }

  private async applyEntries(entries: readonly CountEntry[], executor: ExpectedCountExecutor): Promise<number> {
    const pending = this.collectPendingCounts(entries);
    if (pending.size === 0) return 0;

    let updated = 0;
    for (const entry of pending.values()) {
      const seriesId = await this.seriesIdentity.findIdByName(entry.displayName, executor);
      if (seriesId == null) continue;

      // Raise-only, evaluated in SQL so concurrent scans cannot race a read-then-write.
      // Without it the stored total depends on which file or provider was seen last: two comics
      // in one series tagged with different Counts would flip the value on every rescan.
      // Equality is excluded by the same comparison, so no-op writes still never churn updatedAt.
      const rows = await executor
        .update(bookSeries)
        .set({
          expectedBookCount: entry.total,
          expectedBookCountSource: entry.provider,
          expectedBookCountUpdatedAt: new Date(),
        })
        .where(and(eq(bookSeries.id, seriesId), or(isNull(bookSeries.expectedBookCount), lt(bookSeries.expectedBookCount, entry.total))))
        .returning({ id: bookSeries.id });

      updated += rows.length;
    }

    return updated;
  }

  /**
   * Keyed by normalized name so two providers naming the same series differently still collapse.
   * The larger total wins, both here within a batch and against the stored value in
   * {@link applyEntries}: the source counting novellas and companion volumes is usually the
   * complete picture, undercounting silently hides the gaps this feature exists to surface, and
   * taking the maximum is the only rule that makes the result independent of scan order.
   * {@link setManual} is the escape hatch when a person needs to lower or clear it.
   */
  private collectPendingCounts(entries: readonly CountEntry[]): Map<string, PendingCount> {
    const pending = new Map<string, PendingCount>();

    for (const entry of entries) {
      const total = normalizeSeriesTotalBooks(entry.totalBooks);
      if (total === undefined) continue;

      const displayName = this.seriesIdentity.normalizeDisplayName(entry.seriesName);
      const key = this.seriesIdentity.normalizeName(displayName);
      if (!displayName || !key) continue;

      const existing = pending.get(key);
      if (!existing || total > existing.total) {
        pending.set(key, { displayName, total, provider: entry.source });
      }
    }

    return pending;
  }
}
