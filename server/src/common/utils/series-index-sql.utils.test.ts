import { PgDialect, pgTable, varchar } from 'drizzle-orm/pg-core';

import { seriesIndexOrderBy, seriesIndexSortKeySql } from './series-index-sql.utils';

const records = pgTable('records', {
  seriesIndex: varchar('series_index', { length: 20 }),
});

describe('series index SQL', () => {
  it('returns a null sort key for an unnumbered book', () => {
    expect(seriesIndexSortKeySql('records.series_index')).toContain('CASE WHEN records.series_index IS NULL THEN NULL ELSE ARRAY[');
  });

  it('keeps null labels last for descending hierarchical ordering', () => {
    const [sortKey, literalTieBreak] = seriesIndexOrderBy(records.seriesIndex, 'DESC');
    const dialect = new PgDialect();

    expect(dialect.sqlToQuery(sortKey).sql).toContain('CASE WHEN "records"."series_index" IS NULL THEN NULL ELSE ARRAY[');
    expect(dialect.sqlToQuery(sortKey).sql).toContain('DESC NULLS LAST');
    expect(dialect.sqlToQuery(literalTieBreak).sql).toContain('COLLATE "C" DESC NULLS LAST');
  });
});
