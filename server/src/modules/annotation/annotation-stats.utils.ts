import type { AnnotationHubActivityWeek } from '@bookorbit/types';

import type { AnnotationRow } from '../../db/schema';
import type { AnnotationActivityResult, AnnotationChapterStatResult } from './annotation.repository';

export interface ChapterStatRow {
  title: string | null;
  color: string;
  count: number;
  /** Recorded by the converter for anything that arrived as an xpointer. Already a spine index. */
  chapterIndex: number | null;
  /** The `N` in `epubcfi(/6/N!...)`: the 1-based child position of the spine itemref, doubled. */
  cfiSpineStep: number | null;
  firstCreatedAt: Date | string;
}

/**
 * Puts both position sources on one scale. A CFI addresses the spine itemref by its doubled
 * 1-based child position, so `/6/14` is the seventh item, index 6; the converter's chapterIndex
 * is already that index. Mixing the two raw would interleave a KOReader chapter between two
 * Kobo ones, which is what the chapter index of a part-synced book looked like before this.
 */
export function spinePosition(chapterIndex: number | null, cfiSpineStep: number | null): number | null {
  if (chapterIndex != null) return chapterIndex;
  if (cfiSpineStep == null || cfiSpineStep < 2) return null;
  return Math.floor(cfiSpineStep / 2) - 1;
}

export interface ActivityStatRow {
  day: string;
  origin: AnnotationRow['origin'];
  count: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function minNullable(current: number | null, next: number | null): number | null {
  if (next == null) return current;
  if (current == null) return next;
  return Math.min(current, next);
}

/**
 * Collapses the `(chapter_title, color)` grouping the repository asks Postgres for into one
 * entry per chapter. Grouping by both in a single query gives the per-chapter totals and the
 * colour composition together, so the index and the position band cost one aggregate rather
 * than one query each.
 *
 * Chapters are ordered by their position through the book. `order` is absent for formats that
 * carry no resolvable position (PDF), so those fall back to when they were first marked, which
 * matches reading order for anything read once.
 */
export function foldChapterRows(rows: ChapterStatRow[]): AnnotationChapterStatResult[] {
  // Keyed by the title itself, null included, so no sentinel string can collide with a
  // chapter that is genuinely called that.
  const byTitle = new Map<string | null, AnnotationChapterStatResult>();

  for (const row of rows) {
    const key = row.title;
    const existing = byTitle.get(key);
    const createdAt = toIso(row.firstCreatedAt);
    const order = spinePosition(row.chapterIndex, row.cfiSpineStep);
    if (!existing) {
      byTitle.set(key, {
        title: row.title,
        count: row.count,
        colors: [{ color: row.color, count: row.count }],
        chapterIndex: row.chapterIndex,
        order,
        firstCreatedAt: createdAt,
      });
      continue;
    }
    existing.count += row.count;
    existing.colors.push({ color: row.color, count: row.count });
    existing.chapterIndex = minNullable(existing.chapterIndex, row.chapterIndex);
    existing.order = minNullable(existing.order, order);
    if (createdAt < existing.firstCreatedAt) existing.firstCreatedAt = createdAt;
  }

  const chapters = [...byTitle.values()];
  for (const chapter of chapters) {
    chapter.colors.sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  }

  return chapters.sort((a, b) => {
    if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
    if (a.order != null && b.order == null) return -1;
    if (a.order == null && b.order != null) return 1;
    if (a.firstCreatedAt !== b.firstCreatedAt) return a.firstCreatedAt < b.firstCreatedAt ? -1 : 1;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

/** Collapses the `(day, origin)` grouping into one entry per day, newest first. */
export function foldActivityRows(rows: ActivityStatRow[]): AnnotationActivityResult[] {
  const byDay = new Map<string, AnnotationActivityResult>();

  for (const row of rows) {
    const existing = byDay.get(row.day);
    if (!existing) {
      byDay.set(row.day, { day: row.day, count: row.count, origins: [{ origin: row.origin, count: row.count }] });
      continue;
    }
    existing.count += row.count;
    existing.origins.push({ origin: row.origin, count: row.count });
  }

  const days = [...byDay.values()];
  for (const day of days) {
    day.origins.sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));
  }

  return days.sort((a, b) => b.day.localeCompare(a.day));
}

export interface ActivityWeekRow {
  weekStart: string;
  origin: AnnotationRow['origin'];
  count: number;
}

/**
 * Collapses the `(week, origin)` grouping into one entry per week, oldest first, because
 * the hub's sparkline reads left to right through the year. Weeks with no marks are not
 * rows at all; the caller pads the axis.
 */
export function foldActivityWeeks(rows: ActivityWeekRow[]): AnnotationHubActivityWeek[] {
  const byWeek = new Map<string, AnnotationHubActivityWeek>();

  for (const row of rows) {
    const existing = byWeek.get(row.weekStart);
    if (!existing) {
      byWeek.set(row.weekStart, { weekStart: row.weekStart, count: row.count, origins: [{ origin: row.origin, count: row.count }] });
      continue;
    }
    existing.count += row.count;
    existing.origins.push({ origin: row.origin, count: row.count });
  }

  const weeks = [...byWeek.values()];
  for (const week of weeks) {
    week.origins.sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));
  }
  return weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Longest run of consecutive empty weeks between the first mark in the window and now.
 * Measured from the first week that carries a mark rather than from the window edge, so a
 * library that only started last month does not report eleven quiet months.
 */
export function longestQuietWeeks(weeks: AnnotationHubActivityWeek[], now: Date): number {
  if (weeks.length === 0) return 0;
  const first = Date.parse(`${weeks[0]!.weekStart}T00:00:00.000Z`);
  if (Number.isNaN(first)) return 0;

  let longest = 0;
  let previous = first;
  for (const week of weeks.slice(1)) {
    const current = Date.parse(`${week.weekStart}T00:00:00.000Z`);
    if (Number.isNaN(current)) continue;
    longest = Math.max(longest, Math.round((current - previous) / WEEK_MS) - 1);
    previous = current;
  }
  return Math.max(longest, Math.floor((now.getTime() - previous) / WEEK_MS));
}
