import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

export type SqlSortDirection = 'ASC' | 'DESC';
export type SeriesIndexComparisonOperator = '>' | '>=' | '<' | '<=';

export function seriesIndexSortKeySql(columnSql: string): string {
  return `CASE WHEN ${columnSql} IS NULL THEN NULL ELSE ARRAY[
      split_part(${columnSql}::text, '.', 1)::numeric,
      CASE WHEN strpos(${columnSql}::text, '.') = 0 THEN -1::numeric ELSE split_part(${columnSql}::text, '.', 2)::numeric END
    ] END`;
}

export function seriesIndexSortKey(value: SQLWrapper | string): SQL {
  return sql`CASE WHEN ${value} IS NULL THEN NULL ELSE ARRAY[
      split_part(${value}::text, '.', 1)::numeric,
      CASE WHEN strpos(${value}::text, '.') = 0 THEN -1::numeric ELSE split_part(${value}::text, '.', 2)::numeric END
    ] END`;
}

export function seriesIndexOrderBy(value: SQLWrapper, direction: SqlSortDirection): SQL[] {
  return [sql`${seriesIndexSortKey(value)} ${sql.raw(direction)} NULLS LAST`, sql`${value}::text COLLATE "C" ${sql.raw(direction)} NULLS LAST`];
}

export function compareSeriesIndexSql(column: SQLWrapper, operator: SeriesIndexComparisonOperator, value: string): SQL {
  return sql`(${seriesIndexSortKey(column)}, ${column}::text COLLATE "C") ${sql.raw(operator)} (${seriesIndexSortKey(value)}, ${value}::text COLLATE "C")`;
}
