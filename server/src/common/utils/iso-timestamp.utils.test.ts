import { advanceIsoTimestamp, maxIsoTimestamp } from './iso-timestamp.utils';

describe('maxIsoTimestamp', () => {
  it('returns the latest value using the caller original string', () => {
    expect(maxIsoTimestamp('2026-01-01T00:00:00Z', '2026-06-11T15:49:30.355Z', '2025-12-31T23:59:59.999Z')).toBe('2026-06-11T15:49:30.355Z');
  });

  it('ignores nullish and unparsable values', () => {
    expect(maxIsoTimestamp(null, undefined, '', 'not-a-date', '2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z');
  });

  it('returns null when nothing is usable', () => {
    expect(maxIsoTimestamp(null, undefined, 'nonsense')).toBeNull();
  });

  it('keeps the first of two equal instants written differently', () => {
    expect(maxIsoTimestamp('2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000+01:00')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('advanceIsoTimestamp', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');

  it('uses now when every prior timestamp is older', () => {
    expect(advanceIsoTimestamp(now, '2026-08-16T11:59:59.999Z', '2026-01-01T00:00:00.000Z')).toBe('2026-08-16T12:00:00.000Z');
  });

  it('steps past a prior timestamp that already equals now', () => {
    expect(advanceIsoTimestamp(now, '2026-08-16T12:00:00.000Z')).toBe('2026-08-16T12:00:00.001Z');
  });

  // A Kobo clock running ahead stores future timestamps verbatim. Stamping a hub write behind
  // them loses the device conflict check, so the device keeps re-pushing its stale bookmark.
  it('steps past the furthest future timestamp a device reported', () => {
    expect(advanceIsoTimestamp(now, '2026-08-16T13:30:00.000Z', '2026-08-16T14:00:00.000Z', '2026-08-16T12:00:00.000Z')).toBe(
      '2026-08-16T14:00:00.001Z',
    );
  });

  it('stays strictly ahead regardless of the order priors are supplied in', () => {
    const ascending = advanceIsoTimestamp(now, '2026-08-16T13:00:00.000Z', '2026-08-16T14:00:00.000Z');
    const descending = advanceIsoTimestamp(now, '2026-08-16T14:00:00.000Z', '2026-08-16T13:00:00.000Z');
    expect(ascending).toBe(descending);
    expect(new Date(ascending).getTime()).toBeGreaterThan(new Date('2026-08-16T14:00:00.000Z').getTime());
  });

  it('ignores nullish and unparsable priors', () => {
    expect(advanceIsoTimestamp(now, null, undefined, '', 'not-a-date')).toBe('2026-08-16T12:00:00.000Z');
  });

  it('falls back to wall clock when now is invalid', () => {
    const result = advanceIsoTimestamp(new Date('nope'), '2026-01-01T00:00:00.000Z');
    expect(Number.isNaN(new Date(result).getTime())).toBe(false);
  });
});
