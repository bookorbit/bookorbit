import { parsePgTimestamptz } from './pg-timestamp.utils';

function iso(value: string): string {
  return parsePgTimestamptz(value).toISOString();
}

describe('parsePgTimestamptz', () => {
  it('parses the text form the driver returns for a modern timestamp', () => {
    expect(iso('2026-08-25 07:42:00+00')).toBe('2026-08-25T07:42:00.000Z');
  });

  it('keeps millisecond precision and truncates the microseconds Date cannot hold', () => {
    expect(iso('2026-08-25 07:42:00.643+00')).toBe('2026-08-25T07:42:00.643Z');
    expect(iso('2026-08-25 07:42:00.643127+00')).toBe('2026-08-25T07:42:00.643Z');
    expect(iso('2026-08-25 07:42:00.999999+00')).toBe('2026-08-25T07:42:00.999Z');
  });

  it('applies the offset the server rendered the value in', () => {
    expect(iso('2026-08-25 07:42:00-05')).toBe('2026-08-25T12:42:00.000Z');
    expect(iso('2026-08-25 07:42:00+05:30')).toBe('2026-08-25T02:12:00.000Z');
    expect(iso('2026-08-25 07:42:00Z')).toBe('2026-08-25T07:42:00.000Z');
  });

  it('applies a local-mean-time offset carrying seconds', () => {
    // Named zones render pre-1900 instants at their LMT offset, which has a seconds part.
    expect(iso('1850-06-15 00:53:28+00:53:28')).toBe('1850-06-15T00:00:00.000Z');
  });

  it('reads a year below 100 as itself rather than as a two-digit year', () => {
    // The defect: `new Date()` reads these as 1950 and 2001.
    expect(iso('0050-06-15 00:00:00+00')).toBe('0050-06-15T00:00:00.000Z');
    expect(iso('0001-01-01 00:00:00+00')).toBe('0001-01-01T00:00:00.000Z');
    expect(iso('0099-12-31 00:00:00+00')).toBe('0099-12-31T00:00:00.000Z');
  });

  it('parses the year band that made `new Date()` fail outright', () => {
    // Issue #1143: years 0013 to 0031 produced an Invalid Date, so serializing the row threw.
    expect(iso('0013-01-01 00:00:00+00')).toBe('0013-01-01T00:00:00.000Z');
    expect(iso('0025-08-25 00:00:00+00')).toBe('0025-08-25T00:00:00.000Z');
    expect(iso('0031-12-31 00:00:00+00')).toBe('0031-12-31T00:00:00.000Z');
  });

  it('round-trips the year of every value Postgres can render in four digits', () => {
    for (let year = 1; year <= 9999; year++) {
      const rendered = `${String(year).padStart(4, '0')}-06-15 00:00:00+00`;
      const parsed = parsePgTimestamptz(rendered);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.getUTCFullYear()).toBe(year);
      expect(parsed.getUTCMonth()).toBe(5);
      expect(parsed.getUTCDate()).toBe(15);
    }
  });

  it('parses years past four digits', () => {
    expect(parsePgTimestamptz('10000-01-01 00:00:00+00').getUTCFullYear()).toBe(10000);
  });

  it('maps a BC year onto its astronomical year', () => {
    // Postgres numbers BC years from 1, so 1 BC is astronomical year 0.
    expect(parsePgTimestamptz('0001-01-01 00:00:00+00 BC').getUTCFullYear()).toBe(0);
    expect(parsePgTimestamptz('4713-01-01 00:00:00+00 BC').getUTCFullYear()).toBe(-4712);
  });

  it('returns an invalid date for a value outside the range Date can hold', () => {
    expect(Number.isNaN(parsePgTimestamptz('294276-12-31 00:00:00+00').getTime())).toBe(true);
  });

  it('passes a Date through untouched', () => {
    const date = new Date('2026-08-25T07:42:00.000Z');
    expect(parsePgTimestamptz(date)).toBe(date);
  });

  it('falls back to Date parsing for anything it does not recognize', () => {
    expect(iso('2026-08-25T07:42:00.000Z')).toBe('2026-08-25T07:42:00.000Z');
    expect(Number.isNaN(parsePgTimestamptz('not a timestamp').getTime())).toBe(true);
  });
});
