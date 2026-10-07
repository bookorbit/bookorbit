import { addDateKeyDays } from '../../common/utils/reading-daily-stats.utils';
import { getYearInTimeZone, isDateKey, toTimeZoneStartOfDay } from '../../common/utils/timezone.utils';

/** A deck's "older" tier is anything written at least this long before the deck's date. */
export const REVIEW_OLDER_THAN_DAYS = 30;
/** On this day looks back at most this many years, whatever the oldest entry claims. */
export const ON_THIS_DAY_YEARS_MAX = 100;
/** Date keys below this year are outside what the calendar helpers handle; no real entry is that old. */
const EARLIEST_YEAR = 1000;

export interface OnThisDayRange {
  year: number;
  start: string;
  end: string;
}

/**
 * One half-open range per earlier year, newest first: that year's month and day, from local
 * midnight to the next local midnight in `timeZone`. A year without the day (29 February outside a
 * leap year) has no range, and neither has a day whose local midnight the zone skips.
 */
export function onThisDayRanges(date: string, firstYear: number | null, timeZone: string): OnThisDayRange[] {
  if (firstYear == null) return [];
  const year = Number(date.slice(0, 4));
  const monthDay = date.slice(4);
  const earliest = Math.max(firstYear, year - ON_THIS_DAY_YEARS_MAX, EARLIEST_YEAR);
  const ranges: OnThisDayRange[] = [];
  for (let candidate = year - 1; candidate >= earliest; candidate--) {
    const day = `${String(candidate).padStart(4, '0')}${monthDay}`;
    if (!isDateKey(day)) continue;
    try {
      ranges.push({
        year: candidate,
        start: toTimeZoneStartOfDay(day, timeZone).toISOString(),
        end: toTimeZoneStartOfDay(addDateKeyDays(day, 1), timeZone).toISOString(),
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return ranges;
}

/** The start of the day `REVIEW_OLDER_THAN_DAYS` before `date`, in UTC, so a deck never depends on the clock. */
export function reviewOlderThan(date: string): string {
  return toTimeZoneStartOfDay(addDateKeyDays(date, -REVIEW_OLDER_THAN_DAYS), 'UTC').toISOString();
}

/** A microsecond sort key as the millisecond ISO string every other timestamp in the API uses. */
export function isoFromSortKey(key: string): string {
  return new Date(`${key.slice(0, 23)}Z`).toISOString();
}

/** The year a sort key falls in for `timeZone`, or its UTC year when the calendar helpers cannot place it. */
export function localYearOfSortKey(key: string, timeZone: string): number {
  try {
    return getYearInTimeZone(new Date(isoFromSortKey(key)), timeZone);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Number(key.slice(0, 4));
  }
}

/**
 * The year of the range a sort key falls in, or null when it is in none. Ranges start on whole
 * milliseconds, so dropping the key's microseconds can never move it across a boundary.
 */
export function rangeYearOfSortKey(key: string, ranges: readonly OnThisDayRange[]): number | null {
  const at = Date.parse(isoFromSortKey(key));
  return ranges.find((range) => at >= Date.parse(range.start) && at < Date.parse(range.end))?.year ?? null;
}
