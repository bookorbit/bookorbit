import { describe, expect, it } from 'vitest';

import {
  isPublishedDateKey,
  normalizePublishedDate,
  parseCompactPublishedDate,
  parsePublishedDateFromEpochMillis,
  parsePublishedDateKey,
  parsePublishedYear,
  publishedYearFromDateKey,
} from './published-date.utils';

describe('published-date utils', () => {
  it('accepts valid calendar date keys within the supported publication year range', () => {
    expect(isPublishedDateKey('1965-08-01')).toBe(true);
    expect(isPublishedDateKey('1000-01-01')).toBe(true);
    expect(isPublishedDateKey('2200-12-31')).toBe(true);
  });

  it('rejects impossible dates, partial dates, and years outside the supported range', () => {
    expect(isPublishedDateKey('1965-02-29')).toBe(false);
    expect(isPublishedDateKey('1965-08')).toBe(false);
    expect(isPublishedDateKey('0999-12-31')).toBe(false);
    expect(isPublishedDateKey('2201-01-01')).toBe(false);
  });

  it('normalizes common full-date strings without inventing a day for year-only input', () => {
    expect(parsePublishedDateKey('1965/8/1')).toBe('1965-08-01');
    expect(parsePublishedDateKey('1965-08-01T12:30:00Z')).toBe('1965-08-01');
    expect(parsePublishedDateKey('August 1, 1965')).toBe('1965-08-01');
    expect(parsePublishedDateKey('1965')).toBeUndefined();
  });

  it('parses compact date and epoch timestamp sources', () => {
    expect(parseCompactPublishedDate('19650801')).toBe('1965-08-01');
    expect(parseCompactPublishedDate('19650229')).toBeUndefined();
    expect(parsePublishedDateFromEpochMillis(Date.UTC(1965, 7, 1))).toBe('1965-08-01');
  });

  it('normalizes nullable update values', () => {
    expect(normalizePublishedDate(undefined)).toBeUndefined();
    expect(normalizePublishedDate(null)).toBeNull();
    expect(normalizePublishedDate('')).toBeNull();
    expect(normalizePublishedDate('1965-08-01')).toBe('1965-08-01');
    expect(normalizePublishedDate('1965-02-29')).toBeNull();
  });

  it('extracts and derives publication years', () => {
    expect(parsePublishedYear('Published in 1965 by Chilton')).toBe(1965);
    expect(parsePublishedYear('999')).toBeUndefined();
    expect(publishedYearFromDateKey('1965-08-01')).toBe(1965);
  });
});
