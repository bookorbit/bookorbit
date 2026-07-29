import { describe, expect, it } from 'vitest';

import { isDateKey, isValidTimeZone, resolveTimeZone, toDateKeyInTimeZone, toTimeZoneStartOfDay } from './timezone.utils';

describe('timezone utils', () => {
  it('validates IANA timezones and rejects invalid values', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Denver')).toBe(true);
    expect(isValidTimeZone('Invalid/Zone')).toBe(false);
  });

  it('resolves timezone from user value with UTC fallback', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('Invalid/Zone')).toBe('UTC');
    expect(resolveTimeZone('')).toBe('UTC');
    expect(resolveTimeZone(undefined)).toBe('UTC');
    expect(resolveTimeZone('Invalid/Zone', 'America/Denver')).toBe('America/Denver');
  });

  it('validates date keys with strict calendar checks', () => {
    expect(isDateKey('0000-01-01')).toBe(false);
    expect(isDateKey('0001-01-01')).toBe(true);
    expect(isDateKey('0021-12-31')).toBe(true);
    expect(isDateKey('0099-01-01')).toBe(true);
    expect(isDateKey('0100-01-01')).toBe(true);
    expect(isDateKey('0999-12-31')).toBe(true);
    expect(isDateKey('2026-05-20')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-05-32')).toBe(false);
    expect(isDateKey('2026/05/20')).toBe(false);
  });

  it('formats a UTC instant into the corresponding date key in a timezone', () => {
    const instant = new Date('2026-01-01T02:30:00.000Z');
    expect(toDateKeyInTimeZone(instant, 'UTC')).toBe('2026-01-01');
    expect(toDateKeyInTimeZone(instant, 'America/New_York')).toBe('2025-12-31');
  });

  it.each(['0001-01-01', '0021-12-31', '0099-01-01', '0100-01-01', '0999-12-31'])('preserves a four-digit year when formatting %s', (dateKey) => {
    expect(toDateKeyInTimeZone(new Date(`${dateKey}T12:00:00.000Z`), 'UTC')).toBe(dateKey);
  });

  it('rejects dates outside the supported date-key range', () => {
    expect(() => toDateKeyInTimeZone(new Date('0000-01-01T12:00:00.000Z'), 'UTC')).toThrow(RangeError);
    expect(() => toDateKeyInTimeZone(new Date('+010000-01-01T12:00:00.000Z'), 'UTC')).toThrow(RangeError);
  });

  it('converts a date key to a UTC timestamp representing local midnight', () => {
    const utcMidnight = toTimeZoneStartOfDay('2026-05-20', 'UTC');
    expect(utcMidnight.toISOString()).toBe('2026-05-20T00:00:00.000Z');

    const denverMidnight = toTimeZoneStartOfDay('2026-05-20', 'America/Denver');
    expect(toDateKeyInTimeZone(denverMidnight, 'America/Denver')).toBe('2026-05-20');
  });

  it.each(['0001-01-01', '0021-12-31', '0099-01-01'])('converts low-year date key %s without applying a 1900 offset', (dateKey) => {
    const utcMidnight = toTimeZoneStartOfDay(dateKey, 'UTC');
    expect(toDateKeyInTimeZone(utcMidnight, 'UTC')).toBe(dateKey);

    const denverMidnight = toTimeZoneStartOfDay(dateKey, 'America/Denver');
    expect(toDateKeyInTimeZone(denverMidnight, 'America/Denver')).toBe(dateKey);
  });

  it('throws when date key is malformed', () => {
    expect(() => toTimeZoneStartOfDay('2026-02-30', 'UTC')).toThrow(RangeError);
  });
});
