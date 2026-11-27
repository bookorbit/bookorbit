import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

import { seriesUnitRank, seriesUnitRankSql } from './series-unit.utils';

export type SqlSortDirection = 'ASC' | 'DESC';
export type SeriesIndexComparisonOperator = '>' | '>=' | '<' | '<=' | '=';

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

/**
 * The run a chapter or issue sits in, as an order key. It is never null: a book that names no
 * volume gets an array of nulls, which sorts after every numbered run ascending, equals itself, and
 * so needs no NULLS clause in an index, an ORDER BY or a row comparison.
 */
export function seriesVolumeSortKeySql(columnSql: string): string {
  return `ARRAY[
      split_part(${columnSql}::text, '.', 1)::numeric,
      CASE WHEN ${columnSql} IS NULL THEN NULL WHEN strpos(${columnSql}::text, '.') = 0 THEN -1::numeric ELSE split_part(${columnSql}::text, '.', 2)::numeric END
    ]`;
}

export function seriesVolumeSortKey(value: SQLWrapper | string): SQL {
  return sql`ARRAY[
      split_part(${value}::text, '.', 1)::numeric,
      CASE WHEN ${value} IS NULL THEN NULL WHEN strpos(${value}::text, '.') = 0 THEN -1::numeric ELSE split_part(${value}::text, '.', 2)::numeric END
    ]`;
}

/**
 * Series order: volumes and unclassified books first, then chapters and issues run by run, each by
 * number. `unit` and `volume` are the series unit and volume index columns beside `value`; every
 * series index leads on the same rank and run.
 */
export function seriesIndexOrderBy(value: SQLWrapper, unit: SQLWrapper, volume: SQLWrapper, direction: SqlSortDirection): SQL[] {
  return [
    sql`${seriesUnitRank(unit)} ${sql.raw(direction)}`,
    sql`${seriesVolumeSortKey(volume)} ${sql.raw(direction)}`,
    sql`${seriesIndexSortKey(value)} ${sql.raw(direction)} NULLS LAST`,
    sql`${value}::text COLLATE "C" ${sql.raw(direction)} NULLS LAST`,
  ];
}

/** `seriesIndexOrderBy` for hand-written SQL, without the literal tie break. */
export function seriesOrderKeySql(indexColumnSql: string, unitColumnSql: string, volumeColumnSql: string, direction: SqlSortDirection): string {
  return `${seriesUnitRankSql(unitColumnSql)} ${direction}, ${seriesVolumeSortKeySql(volumeColumnSql)} ${direction}, ${seriesIndexSortKeySql(indexColumnSql)} ${direction} NULLS LAST`;
}

/** Compares a run column with a run, where null is the run of chapters that name no volume. */
export function compareSeriesVolumeSql(column: SQLWrapper, operator: SeriesIndexComparisonOperator, value: string | null): SQL {
  return sql`${seriesVolumeSortKey(column)} ${sql.raw(operator)} ${seriesVolumeSortKey(sql`${value}::text`)}`;
}

export function compareSeriesIndexSql(column: SQLWrapper, operator: SeriesIndexComparisonOperator, value: string): SQL {
  // The compared value is a bound parameter, and Postgres cannot infer a type for one that appears
  // bare in a null test (42P18). Only the literal side is cast: casting the column side instead
  // would stop the sort key matching the expression index the series ordering relies on.
  const literal = sql`${value}::text`;
  return sql`(${seriesIndexSortKey(column)}, ${column}::text COLLATE "C") ${sql.raw(operator)} (${seriesIndexSortKey(literal)}, ${literal} COLLATE "C")`;
}
