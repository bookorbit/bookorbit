import { resolveSystemTimeZone } from '../../common/utils/timezone.utils';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` in the server's time zone, the month budgets and usage count against. */
export function aiMonthKey(at: Date = new Date(), timeZone: string = resolveSystemTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(at.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function isAiMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

export function shiftAiMonth(month: string, delta: number): string {
  const match = MONTH_RE.exec(month);
  if (!match) throw new RangeError(`Invalid month ${month}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive, oldest first. */
export function aiMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = shiftAiMonth(month, 1)) months.push(month);
  return months;
}
