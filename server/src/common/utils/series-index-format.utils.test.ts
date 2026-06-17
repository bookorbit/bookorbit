import { describe, expect, it } from 'vitest';

import { formatSeriesIndex } from './series-index-format.utils';

describe('formatSeriesIndex', () => {
  it('returns null for null input', () => {
    expect(formatSeriesIndex(null)).toBeNull();
  });

  it('formats whole numbers with zero-padding', () => {
    expect(formatSeriesIndex(0)).toBe('00');
    expect(formatSeriesIndex(1)).toBe('01');
    expect(formatSeriesIndex(5)).toBe('05');
    expect(formatSeriesIndex(12)).toBe('12');
    expect(formatSeriesIndex(100)).toBe('100');
  });

  it('preserves decimal digits without binary floating-point expansion', () => {
    expect(formatSeriesIndex(1.5)).toBe('01.5');
    expect(formatSeriesIndex(3.25)).toBe('03.25');
    expect(formatSeriesIndex(5.02)).toBe('05.02');
    expect(formatSeriesIndex(5.08)).toBe('05.08');
    expect(formatSeriesIndex(5.09)).toBe('05.09');
    expect(formatSeriesIndex(5.1)).toBe('05.1');
    expect(formatSeriesIndex(5.11)).toBe('05.11');
  });
});
