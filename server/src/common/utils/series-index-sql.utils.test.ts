import { PgDialect, pgTable, varchar } from 'drizzle-orm/pg-core';

import { compareSeriesIndexSql, compareSeriesVolumeSql, seriesIndexOrderBy, seriesIndexSortKeySql } from './series-index-sql.utils';

const records = pgTable('records', {
  seriesIndex: varchar('series_index', { length: 20 }),
  seriesUnit: varchar('series_unit', { length: 10 }),
  seriesVolumeIndex: varchar('series_volume_index', { length: 20 }),
});

describe('series index SQL', () => {
  it('returns a null sort key for an unnumbered book', () => {
    expect(seriesIndexSortKeySql('records.series_index')).toContain('CASE WHEN records.series_index IS NULL THEN NULL ELSE ARRAY[');
  });

  it('keeps null labels last for descending hierarchical ordering', () => {
    const [unitRank, runKey, sortKey, literalTieBreak] = seriesIndexOrderBy(
      records.seriesIndex,
      records.seriesUnit,
      records.seriesVolumeIndex,
      'DESC',
    );
    const dialect = new PgDialect();

    expect(dialect.sqlToQuery(unitRank).sql).toBe(`(CASE WHEN "records"."series_unit" IN ('chapter', 'issue') THEN 1 ELSE 0 END) DESC`);
    expect(dialect.sqlToQuery(runKey).sql).toContain('ARRAY[');
    expect(dialect.sqlToQuery(runKey).sql).not.toContain('NULLS');
    expect(dialect.sqlToQuery(sortKey).sql).toContain('CASE WHEN "records"."series_index" IS NULL THEN NULL ELSE ARRAY[');
    expect(dialect.sqlToQuery(sortKey).sql).toContain('DESC NULLS LAST');
    expect(dialect.sqlToQuery(literalTieBreak).sql).toContain('COLLATE "C" DESC NULLS LAST');
  });

  it('casts the compared value so Postgres can type the bound parameter', () => {
    const { sql: rendered, params } = new PgDialect().sqlToQuery(compareSeriesIndexSql(records.seriesIndex, '>', '10'));

    expect(rendered).toContain('CASE WHEN $1::text IS NULL');
    expect(rendered).not.toContain('CASE WHEN $1 IS NULL');
    expect(params).toEqual(['10', '10', '10', '10', '10']);
  });

  it('leaves the column side of the comparison uncast so it still matches the series index expression', () => {
    const { sql: rendered } = new PgDialect().sqlToQuery(compareSeriesIndexSql(records.seriesIndex, '>', '10'));

    expect(rendered).toContain('CASE WHEN "records"."series_index" IS NULL');
  });

  it('orders runs on a key that is never null, so books naming no volume compare equal to each other', () => {
    const { sql: rendered, params } = new PgDialect().sqlToQuery(compareSeriesVolumeSql(records.seriesVolumeIndex, '=', null));

    expect(rendered.startsWith('ARRAY[')).toBe(true);
    expect(rendered).toContain('CASE WHEN $');
    expect(rendered).toContain('::text IS NULL');
    expect(params.every((param) => param === null)).toBe(true);
  });
});
