import { sql, type SQL } from 'drizzle-orm';

import { seriesUnitRank } from '../common/utils/series-unit.utils';
import { MAX_SERIES_TOTAL_BOOKS } from '../common/utils/series-total-books.utils';
import { bookSeries, bookSeriesMemberships, books } from './schema';

/**
 * "This series is missing a volume or a chapter", decided in SQL over a query grouped by series
 * that joins `books` through `book_series_memberships` to `book_series`. The Series page's Gaps tab
 * and the `seriesStatus` `hasGaps` book filter both use it, so the two can never disagree about a
 * series.
 *
 * It mirrors `computeSeriesClassGaps` branch for branch. Volumes (with unclassified books) and
 * chapters (with issues) are separate number lines, and each run of chapters or issues is a line of
 * its own, because issue numbers restart in each volume of a comic. On the volume line a provider
 * total is only trusted when every volume is numbered with a plain integer and none of them runs
 * past the total; chapter runs never use one, and without a trusted total only interior holes are
 * knowable.
 *
 * Indices of ten digits or more are treated as unusable rather than cast, which is where this is
 * fractionally stricter than the TypeScript: that function drops them for exceeding the
 * safe-integer range, and either way the line reports no gaps.
 */
export function seriesHasGapsSql(): SQL<boolean> {
  return sql<boolean>`(${volumeLineHasGaps()} OR ${chapterRunsHaveGaps()})`;
}

function volumeLineHasGaps(): SQL {
  const inLine = sql`${seriesUnitRank(bookSeriesMemberships.seriesUnit)} = 0`;
  const idx = sql`CASE WHEN ${inLine} THEN ${bookSeriesMemberships.seriesIndex} END`;
  const intIdx = sql`CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${idx}::int END`;

  const lineCount = sql`count(distinct CASE WHEN ${inLine} THEN ${books.id} END)`;
  const numberedCount = sql`count(distinct CASE WHEN ${idx} IS NOT NULL THEN ${books.id} END)`;
  const integerCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${books.id} END)`;
  const oversizedCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{10,}$' THEN ${books.id} END)`;
  const minIdx = sql`min(${intIdx})`;
  const maxIdx = sql`max(${intIdx})`;
  const distinctIdx = sql`count(distinct ${intIdx})`;
  const expected = sql`${bookSeries.expectedBookCount}`;

  const interior = sql`${integerCount} >= 2 AND ${distinctIdx} < (${maxIdx} - ${minIdx} + 1)`;
  const gapTest = sql`CASE
      WHEN (
        ${expected} IS NOT NULL
        AND ${expected} BETWEEN 1 AND ${MAX_SERIES_TOTAL_BOOKS}
        AND ${numberedCount} = ${lineCount}
        AND ${integerCount} = ${numberedCount}
        AND ${maxIdx} <= ${expected}
      ) THEN ${distinctIdx} < ${expected}
      ELSE ${interior}
    END`;

  return sql`(
    ${integerCount} > 0
    AND ${oversizedCount} = 0
    AND ${minIdx} >= 1
    AND ${maxIdx} <= ${MAX_SERIES_TOTAL_BOOKS}
    AND ${gapTest}
  )`;
}

/**
 * Interior holes in any run of the chapter line. The group's chapter rows are gathered into one
 * array and regrouped by run in a subquery, which a single grouped pass cannot do: chapters that
 * name no volume form a run of their own.
 */
function chapterRunsHaveGaps(): SQL {
  const inLine = sql`${seriesUnitRank(bookSeriesMemberships.seriesUnit)} = 1`;
  const rows = sql`jsonb_agg(jsonb_build_array(${bookSeriesMemberships.seriesVolumeIndex}, ${bookSeriesMemberships.seriesIndex}, ${books.id})) FILTER (WHERE ${inLine})`;
  const idx = sql.raw(`(chapter_row->>1)`);
  const book = sql.raw(`(chapter_row->>2)`);
  const intIdx = sql`CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${idx}::int END`;
  const integerCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${book} END)`;
  const oversizedCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{10,}$' THEN ${book} END)`;

  return sql`coalesce((
    SELECT bool_or(run_gaps.has_gaps)
    FROM (
      SELECT (
        ${integerCount} >= 2
        AND ${oversizedCount} = 0
        AND min(${intIdx}) >= 1
        AND max(${intIdx}) <= ${MAX_SERIES_TOTAL_BOOKS}
        AND count(distinct ${intIdx}) < (max(${intIdx}) - min(${intIdx}) + 1)
      ) AS has_gaps
      FROM jsonb_array_elements(${rows}) AS chapter_row
      GROUP BY chapter_row->>0
    ) run_gaps
  ), false)`;
}
