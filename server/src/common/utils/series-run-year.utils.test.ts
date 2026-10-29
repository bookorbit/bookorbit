import { describe, expect, it } from 'vitest';

import { isRunYearQualifiedName, splitSeriesRunYear } from './series-run-year.utils';

describe('splitSeriesRunYear', () => {
  it('splits a trailing run year off the name', () => {
    expect(splitSeriesRunYear('Batman (2016)')).toEqual({ base: 'Batman', year: 2016 });
    expect(splitSeriesRunYear('Spider-Man 2099 (1992)')).toEqual({ base: 'Spider-Man 2099', year: 1992 });
    expect(splitSeriesRunYear('  Saga(2012) ')).toEqual({ base: 'Saga', year: 2012 });
  });

  it('ignores names without a trailing year in parentheses', () => {
    expect(splitSeriesRunYear('Batman')).toBeNull();
    expect(splitSeriesRunYear('Spider-Man 2099')).toBeNull();
    expect(splitSeriesRunYear("The Novel's Extra (Remake)")).toBeNull();
    expect(splitSeriesRunYear('Batman (2016) Annual')).toBeNull();
    expect(splitSeriesRunYear('(2016)')).toBeNull();
    expect(splitSeriesRunYear(null)).toBeNull();
  });

  it('only treats plausible publication years as run years', () => {
    expect(splitSeriesRunYear('Star Trek (1701)')).toBeNull();
    expect(splitSeriesRunYear('Odyssey (2101)')).toBeNull();
  });
});

describe('isRunYearQualifiedName', () => {
  it('matches the bare name case- and spacing-insensitively', () => {
    expect(isRunYearQualifiedName('Batman (2016)', 'Batman')).toBe(true);
    expect(isRunYearQualifiedName('The  Boys (2006)', 'the boys')).toBe(true);
  });

  it('rejects a different title or a name without a year', () => {
    expect(isRunYearQualifiedName('Batman (2016)', 'Batgirl')).toBe(false);
    expect(isRunYearQualifiedName('Batman', 'Batman')).toBe(false);
    expect(isRunYearQualifiedName('Batman (2016)', 'Batman (2011)')).toBe(false);
    expect(isRunYearQualifiedName('Batman (2016)', null)).toBe(false);
  });
});
