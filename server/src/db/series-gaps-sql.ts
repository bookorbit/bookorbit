import { sql, type SQL } from 'drizzle-orm';

import { MAX_SERIES_TOTAL_BOOKS } from '../common/utils/series-total-books.utils';
import { bookSeries, bookSeriesMemberships, books } from './schema';

/**
 * "This series is missing a volume", decided in SQL over a query grouped by series that joins
 * `books` through `book_series_memberships` to `book_series`. The Series page's Gaps tab and the
 * `seriesStatus` `hasGaps` book filter both use it, so the two can never disagree about a series.
 *
 * It mirrors `computeSeriesGaps` branch for branch: a provider total is only trusted when every
 * book is numbered with a plain integer and none of them runs past the total, and without a
 * trusted total only interior holes are knowable.
 *
 * Indices of ten digits or more are treated as unusable rather than cast, which is where this is
 * fractionally stricter than the TypeScript: that function drops them for exceeding the
 * safe-integer range, and either way the series reports no gaps.
 */
export function seriesHasGapsSql(bookCountExpr: SQL<number>): SQL<boolean> {
  const idx = bookSeriesMemberships.seriesIndex;
  const intIdx = sql`CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${idx}::int END`;

  const numberedCount = sql`count(distinct CASE WHEN ${idx} IS NOT NULL THEN ${books.id} END)`;
  const integerCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${books.id} END)`;
  const oversizedCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{10,}$' THEN ${books.id} END)`;
  const minIdx = sql`min(${intIdx})`;
  const maxIdx = sql`max(${intIdx})`;
  const distinctIdx = sql`count(distinct ${intIdx})`;
  const expected = sql`${bookSeries.expectedBookCount}`;

  const trusted = sql`(
    ${expected} IS NOT NULL
    AND ${expected} BETWEEN 1 AND ${MAX_SERIES_TOTAL_BOOKS}
    AND ${numberedCount} = ${bookCountExpr}
    AND ${integerCount} = ${numberedCount}
    AND ${maxIdx} <= ${expected}
  )`;

  return sql<boolean>`(
    ${integerCount} > 0
    AND ${oversizedCount} = 0
    AND ${minIdx} >= 1
    AND ${maxIdx} <= ${MAX_SERIES_TOTAL_BOOKS}
    AND CASE
      WHEN ${trusted} THEN ${distinctIdx} < ${expected}
      ELSE ${integerCount} >= 2 AND ${distinctIdx} < (${maxIdx} - ${minIdx} + 1)
    END
  )`;
}
