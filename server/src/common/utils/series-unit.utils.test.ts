import { classifySeriesUnitMarker, seriesUnitClass } from '@bookorbit/types';
import { PgDialect, pgTable, varchar } from 'drizzle-orm/pg-core';

import { seriesUnitClassFilter, seriesUnitsApplyToPath } from './series-unit.utils';

const records = pgTable('records', { seriesUnit: varchar('series_unit', { length: 10 }) });

describe('series units', () => {
  it.each([
    ['v', 'volume'],
    ['Vol.', 'volume'],
    ['Volume ', 'volume'],
    ['T', 'volume'],
    ['tome', 'volume'],
    ['Band', 'volume'],
    ['巻', 'volume'],
    ['권', 'volume'],
    ['c', 'chapter'],
    ['Ch. ', 'chapter'],
    ['chapitre', 'chapter'],
    ['Capítulo', 'chapter'],
    ['第', 'chapter'],
    ['話', 'chapter'],
    ['화', 'chapter'],
    ['#', 'issue'],
    ['# ', 'issue'],
    ['Issue', 'issue'],
    ['No.', 'issue'],
    ['N°', 'issue'],
  ])('classifies %s as %s', (marker, unit) => {
    expect(classifySeriesUnitMarker(marker)).toBe(unit);
  });

  it.each(['book', 'Book', 'livre', 'libro', 'part', 'pt', 'season', '', null, undefined, 'constructor'])('names no unit for %s', (marker) => {
    expect(classifySeriesUnitMarker(marker)).toBeNull();
  });

  it('groups issues with chapters and unclassified books with volumes', () => {
    expect(seriesUnitClass('issue')).toBe('chapter');
    expect(seriesUnitClass('chapter')).toBe('chapter');
    expect(seriesUnitClass('volume')).toBe('volume');
    expect(seriesUnitClass(null)).toBe('volume');
  });

  it.each([
    ['Berserk/Berserk v01.cbz', true],
    ['Berserk/Berserk v01.CBR', true],
    ['Saga/Saga #1.cb7', true],
    ['Saga/Saga #1.cbt', true],
    ['Novels/Book Vol. 2.epub', false],
    ['Scans/Volume 1.pdf', false],
    [null, false],
  ])('applies units to %s: %s', (path, expected) => {
    expect(seriesUnitsApplyToPath(path)).toBe(expected);
  });

  it('filters a class by the rank the series indexes lead on', () => {
    const dialect = new PgDialect();

    expect(dialect.sqlToQuery(seriesUnitClassFilter(records.seriesUnit, 'chapter')).sql).toBe(
      `(CASE WHEN "records"."series_unit" IN ('chapter', 'issue') THEN 1 ELSE 0 END) = 1`,
    );
    expect(dialect.sqlToQuery(seriesUnitClassFilter(records.seriesUnit, 'volume')).sql).toBe(
      `(CASE WHEN "records"."series_unit" IN ('chapter', 'issue') THEN 1 ELSE 0 END) = 0`,
    );
  });
});
