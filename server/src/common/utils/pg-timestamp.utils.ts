/**
 * PostgreSQL emits `timestamp with time zone` as text, and the driver hands that text
 * straight through. `new Date()` parses the space-separated form with V8's legacy parser,
 * which reads a zero-padded year below 100 as a two-digit year: `0050-06-15` comes back as
 * 1950, and years 0013 to 0031 fail to parse entirely. Any column that can hold a
 * user-supplied date must be decoded here instead.
 */
const PG_TIMESTAMPTZ_RE =
  /^(?<year>\d+)-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?:Z|(?<sign>[+-])(?<offsetHours>\d{2})(?::?(?<offsetMinutes>\d{2}))?(?::?(?<offsetSeconds>\d{2}))?)?(?<era> BC)?$/;

export function parsePgTimestamptz(value: string | Date): Date {
  if (value instanceof Date) return value;

  const groups = PG_TIMESTAMPTZ_RE.exec(value)?.groups;
  if (!groups) return new Date(value);

  // Postgres numbers BC years from 1, so 1 BC is astronomical year 0.
  const calendarYear = Number(groups.year);
  const year = groups.era ? 1 - calendarYear : calendarYear;
  // Postgres keeps microseconds; Date only holds milliseconds, so drop the excess rather
  // than rounding a value like .9996 up into the next second.
  const milliseconds = groups.fraction ? Math.trunc(Number(`0.${groups.fraction}`) * 1000) : 0;

  // Assigning the parts separately avoids Date.UTC(), which maps years 0 to 99 into 1900.
  const date = new Date(0);
  date.setUTCHours(Number(groups.hour), Number(groups.minute), Number(groups.second), milliseconds);
  date.setUTCFullYear(year, Number(groups.month) - 1, Number(groups.day));

  if (!groups.sign) return date;
  const offsetSeconds = Number(groups.offsetHours) * 3600 + Number(groups.offsetMinutes ?? 0) * 60 + Number(groups.offsetSeconds ?? 0);
  const offsetMs = (groups.sign === '-' ? -1 : 1) * offsetSeconds * 1000;
  return offsetMs === 0 ? date : new Date(date.getTime() - offsetMs);
}
