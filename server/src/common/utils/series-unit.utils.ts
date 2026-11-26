import { extname } from 'node:path';
import type { SeriesUnitClass } from '@bookorbit/types';
import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/** Comic files are the only ones whose markers name a unit; in prose titles "Vol. 2" is part of the name. */
const SERIES_UNIT_EXTENSIONS: ReadonlySet<string> = new Set(['.cbz', '.cbr', '.cb7', '.cbt']);

export function seriesUnitsApplyToPath(relativePath: string | null | undefined): boolean {
  return !!relativePath && SERIES_UNIT_EXTENSIONS.has(extname(relativePath).toLowerCase());
}

/**
 * 0 for volumes and unclassified books, 1 for chapters and issues. It leads every series order and
 * the series indexes, so it must stay the exact expression those indexes were built on.
 */
export function seriesUnitRank(unit: SQLWrapper): SQL {
  return sql`(CASE WHEN ${unit} IN ('chapter', 'issue') THEN 1 ELSE 0 END)`;
}

export function seriesUnitRankSql(columnSql: string): string {
  return `(CASE WHEN ${columnSql} IN ('chapter', 'issue') THEN 1 ELSE 0 END)`;
}

export function seriesUnitClassRank(unitClass: SeriesUnitClass): 0 | 1 {
  return unitClass === 'chapter' ? 1 : 0;
}

/** Books of one class: chapters with issues, or volumes with unclassified books. */
export function seriesUnitClassFilter(unit: SQLWrapper, unitClass: SeriesUnitClass): SQL {
  return sql`${seriesUnitRank(unit)} = ${sql.raw(String(seriesUnitClassRank(unitClass)))}`;
}
