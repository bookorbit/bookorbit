const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
type DateTimePartType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'era';

function getDatePart(parts: Intl.DateTimeFormatPart[], type: DateTimePartType): string {
  const part = parts.find((entry) => entry.type === type);
  if (!part) throw new RangeError(`Missing '${type}' in formatted date parts`);
  return part.value;
}

function createUtcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: unknown, fallback = 'UTC'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return isValidTimeZone(normalized) ? normalized : fallback;
}

export function isDateKey(value: string): boolean {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0) return false;
  const parsed = createUtcDate(year, month, day);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function toDateKeyInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(date);
  const era = parts.find((entry) => entry.type === 'era')?.value;
  const year = Number(getDatePart(parts, 'year'));
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');
  if (era !== 'AD' || !Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('Date is outside the supported date-key range');
  }
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

export function toTimeZoneStartOfDay(dateKey: string, timeZone: string): Date {
  if (!isDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  const match = DATE_KEY_RE.exec(dateKey)!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = createUtcDate(year, month, day);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    era: 'short',
  });
  let candidate = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(candidate);
    const formattedYear = Number(getDatePart(parts, 'year'));
    const era = getDatePart(parts, 'era');
    const astronomicalYear = era === 'BC' ? 1 - formattedYear : formattedYear;
    const formattedAsUtc = createUtcDate(
      astronomicalYear,
      Number(getDatePart(parts, 'month')),
      Number(getDatePart(parts, 'day')),
      Number(getDatePart(parts, 'hour')),
      Number(getDatePart(parts, 'minute')),
      Number(getDatePart(parts, 'second')),
    );
    const adjustmentMs = target.getTime() - formattedAsUtc.getTime();
    if (adjustmentMs === 0) return candidate;
    candidate = new Date(candidate.getTime() + adjustmentMs);
  }

  throw new RangeError(`Invalid timezone conversion for date key: ${dateKey}`);
}
