const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = 2200;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAME_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

export function isPublishedYear(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PUBLISHED_YEAR && value <= MAX_PUBLISHED_YEAR;
}

export function parsePublishedYear(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return isPublishedYear(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const match = value.trim().match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (!match) return undefined;

  const year = Number(match[1]);
  return isPublishedYear(year) ? year : undefined;
}

export function isPublishedDateKey(value: string): boolean {
  const match = value.match(DATE_KEY_RE);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isPublishedYear(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function publishedYearFromDateKey(value: string): number {
  return Number(value.slice(0, 4));
}

export function parsePublishedDateKey(value: unknown): string | undefined {
  if (value instanceof Date) {
    return dateToPublishedDateKey(value);
  }
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isPublishedDateKey(trimmed)) return trimmed;

  const separatedMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
  if (separatedMatch) {
    return buildDateKey(separatedMatch[1], separatedMatch[2], separatedMatch[3]);
  }

  const leadingIsoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (leadingIsoMatch && isPublishedDateKey(leadingIsoMatch[1])) {
    return leadingIsoMatch[1];
  }

  if (MONTH_NAME_RE.test(trimmed) && /\b\d{1,2}\b/.test(trimmed) && /\b\d{4}\b/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return dateToPublishedDateKey(parsed);
  }

  return undefined;
}

export function parseCompactPublishedDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{8}$/.test(raw)) return undefined;
  return buildDateKey(raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8));
}

export function parsePublishedDateFromEpochMillis(value: unknown): string | undefined {
  const millis = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(millis)) return undefined;
  return dateToPublishedDateKey(new Date(millis));
}

export function normalizePublishedDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return parsePublishedDateKey(value) ?? null;
}

function buildDateKey(yearValue: string, monthValue: string, dayValue: string): string | undefined {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isPublishedDateKey(key) ? key : undefined;
}

function dateToPublishedDateKey(value: Date): string | undefined {
  if (Number.isNaN(value.getTime())) return undefined;
  const key = value.toISOString().slice(0, 10);
  return isPublishedDateKey(key) ? key : undefined;
}
