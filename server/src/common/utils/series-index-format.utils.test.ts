import { describe, expect, it } from 'vitest';

import { compareSeriesIndices, isPositiveSeriesIndex, isValidSeriesIndex, parseSeriesIndex } from '@bookorbit/types';
import { formatSeriesIndex } from './series-index-format.utils';

describe('formatSeriesIndex', () => {
  it('returns null for null input', () => {
    expect(formatSeriesIndex(null)).toBeNull();
  });

  it('formats whole numbers with zero-padding', () => {
    expect(formatSeriesIndex('0')).toBe('00');
    expect(formatSeriesIndex('1')).toBe('01');
    expect(formatSeriesIndex('5')).toBe('05');
    expect(formatSeriesIndex('12')).toBe('12');
    expect(formatSeriesIndex('100')).toBe('100');
  });

  it('preserves decimal digits without binary floating-point expansion', () => {
    expect(formatSeriesIndex('1.5')).toBe('01.5');
    expect(formatSeriesIndex('3.25')).toBe('03.25');
    expect(formatSeriesIndex('5.02')).toBe('05.02');
    expect(formatSeriesIndex('5.08')).toBe('05.08');
    expect(formatSeriesIndex('5.09')).toBe('05.09');
    expect(formatSeriesIndex('5.10')).toBe('05.10');
    expect(formatSeriesIndex('5.11')).toBe('05.11');
  });

  it('formats legacy numeric values and rejects malformed runtime values', () => {
    expect(formatSeriesIndex(3 as never)).toBe('03');
    expect(formatSeriesIndex(2.5 as never)).toBe('02.5');
    expect(formatSeriesIndex(Number.NaN as never)).toBeNull();
    expect(formatSeriesIndex('not-an-index' as never)).toBeNull();
    expect(formatSeriesIndex({} as never)).toBeNull();
  });

  it('validates and parses exact labels without normalizing their digits', () => {
    expect(['5.10', '01', '0.5'].every(isValidSeriesIndex)).toBe(true);
    expect(parseSeriesIndex(' 5.10 ')).toBe('5.10');
    expect(parseSeriesIndex('1.0')).toBe('1.0');
    expect(parseSeriesIndex(5.1)).toBe('5.1');
    expect(['', ' ', '-1', '1e2', '1.2.3', '123456789012345678901'].some(isValidSeriesIndex)).toBe(false);
  });

  it('orders whole and fractional parts hierarchically with deterministic literal ties', () => {
    expect(compareSeriesIndices('5.2', '5.10')).toBeLessThan(0);
    expect(compareSeriesIndices('5.10', '5.11')).toBeLessThan(0);
    expect(compareSeriesIndices('1', '1.0')).toBeLessThan(0);
    expect(compareSeriesIndices('01', '1')).not.toBe(0);
  });

  it('recognizes positive labels without converting them to floating point', () => {
    expect(isPositiveSeriesIndex('0.00')).toBe(false);
    expect(isPositiveSeriesIndex('0.01')).toBe(true);
  });
});
