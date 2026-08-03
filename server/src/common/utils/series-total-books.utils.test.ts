import { describe, expect, it } from 'vitest';

import { MAX_SERIES_TOTAL_BOOKS, normalizeSeriesTotalBooks } from './series-total-books.utils';

describe('normalizeSeriesTotalBooks', () => {
  it('accepts positive integers', () => {
    expect(normalizeSeriesTotalBooks(1)).toBe(1);
    expect(normalizeSeriesTotalBooks(7)).toBe(7);
    expect(normalizeSeriesTotalBooks(MAX_SERIES_TOTAL_BOOKS)).toBe(MAX_SERIES_TOTAL_BOOKS);
  });

  it('accepts numeric strings because provider payloads are untyped JSON', () => {
    expect(normalizeSeriesTotalBooks('7')).toBe(7);
    expect(normalizeSeriesTotalBooks(' 12 ')).toBe(12);
  });

  it('rejects counts below one', () => {
    expect(normalizeSeriesTotalBooks(0)).toBeUndefined();
    expect(normalizeSeriesTotalBooks(-3)).toBeUndefined();
  });

  it('rejects counts above the ceiling so a bad payload cannot widen gap detection', () => {
    expect(normalizeSeriesTotalBooks(MAX_SERIES_TOTAL_BOOKS + 1)).toBeUndefined();
    expect(normalizeSeriesTotalBooks(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });

  it('rejects non-integers', () => {
    expect(normalizeSeriesTotalBooks(3.5)).toBeUndefined();
    expect(normalizeSeriesTotalBooks(Number.NaN)).toBeUndefined();
    expect(normalizeSeriesTotalBooks(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('rejects absent and non-numeric values', () => {
    expect(normalizeSeriesTotalBooks(undefined)).toBeUndefined();
    expect(normalizeSeriesTotalBooks(null)).toBeUndefined();
    expect(normalizeSeriesTotalBooks('')).toBeUndefined();
    expect(normalizeSeriesTotalBooks('many')).toBeUndefined();
    expect(normalizeSeriesTotalBooks(true)).toBeUndefined();
    expect(normalizeSeriesTotalBooks({})).toBeUndefined();
    expect(normalizeSeriesTotalBooks([])).toBeUndefined();
  });
});
