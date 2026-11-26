import type { SeriesIndex, SeriesUnit, SeriesVolumeSlot, SeriesVolumeStatus } from '@bookorbit/types';
import { SERIES_VOLUME_SLOT_LIMIT, seriesUnitClass } from '@bookorbit/types';

import type { SeriesMemberRow, SeriesVolumeMember } from '../series.repository';
import { computeSeriesClassGaps, computeSeriesGaps, resolveLadderRange } from './series-gaps.utils';

export type SeriesVolumeCounts = {
  ownedVolumeCount: number;
  readVolumeCount: number;
  readingVolumeCount: number;
};

export type SeriesLadder = {
  volumes: SeriesVolumeSlot[];
  truncated: boolean;
  gaps: number[];
  /** Chapter or issue numbers missing between the lowest and highest owned. */
  chapterGaps: number[];
  next: { bookId: number; index: SeriesIndex | null; title: string | null; unit: SeriesUnit | null } | null;
  /** Logical volumes across the whole series, not just the capped slots; null when the members could not all be read. */
  counts: SeriesVolumeCounts | null;
};

const STATUS_RANK: Record<SeriesVolumeStatus, number> = { read: 3, reading: 2, unread: 1, missing: 0 };

function memberStatus(status: string | null): SeriesVolumeStatus {
  if (status === 'read') return 'read';
  if (status === 'reading') return 'reading';
  return 'unread';
}

function integerIndexOf(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function groupSeriesMembers<T extends SeriesVolumeMember>(params: {
  members: T[];
  bookCount: number;
  expectedBookCount: number | null;
}): {
  gaps: number[];
  range: { from: number; to: number } | undefined;
  byIndex: Map<number, T>;
  unnumbered: T[];
} {
  const { members, bookCount, expectedBookCount } = params;
  const indices = members.map((member) => member.seriesIndex).filter((index): index is string => index !== null);
  const gaps = computeSeriesGaps(indices, bookCount, expectedBookCount);
  const range = resolveLadderRange(indices, bookCount, expectedBookCount);
  const byIndex = new Map<number, T>();
  const unnumbered: T[] = [];

  for (const member of members) {
    const index = integerIndexOf(member.seriesIndex);
    if (index === null || !range || index < range.from || index > range.to) {
      unnumbered.push(member);
      continue;
    }
    const held = byIndex.get(index);
    if (!held || STATUS_RANK[memberStatus(member.status)] > STATUS_RANK[memberStatus(held.status)]) {
      byIndex.set(index, member);
    }
  }

  return { gaps, range, byIndex, unnumbered };
}

function tallyVolumes(grouped: { byIndex: ReadonlyMap<number, SeriesVolumeMember>; unnumbered: readonly SeriesVolumeMember[] }): SeriesVolumeCounts {
  const statuses = [...grouped.byIndex.values(), ...grouped.unnumbered].map((member) => memberStatus(member.status));

  return {
    ownedVolumeCount: statuses.length,
    readVolumeCount: statuses.filter((status) => status === 'read').length,
    readingVolumeCount: statuses.filter((status) => status === 'reading').length,
  };
}

/**
 * The members the ladder and its counts run on. Volumes and chapters are separate number lines, so
 * a series with volumes draws those (chapters are counted apart); one with only chapters or issues
 * draws them. A provider total counts volumes, so it never applies to a chapter line. A series with
 * nothing classified keeps its own book count, exactly as before units existed.
 */
function ladderInput<T extends SeriesVolumeMember>(params: {
  members: T[];
  bookCount: number;
  expectedBookCount: number | null;
}): {
  members: T[];
  bookCount: number;
  expectedBookCount: number | null;
} {
  const volumes = params.members.filter((member) => seriesUnitClass(member.unit) === 'volume');
  if (volumes.length === params.members.length) return params;
  if (volumes.length > 0) return { members: volumes, bookCount: volumes.length, expectedBookCount: params.expectedBookCount };
  return { members: params.members, bookCount: params.members.length, expectedBookCount: null };
}

/**
 * Counts logical volumes rather than book records. Numbered copies share one volume and keep the
 * furthest reading state, while books without a usable whole-numbered position stay independent.
 * Chapters are not volumes: a series that has volumes counts only those.
 */
export function countSeriesVolumes(params: {
  members: SeriesVolumeMember[];
  bookCount: number;
  expectedBookCount: number | null;
}): SeriesVolumeCounts {
  return tallyVolumes(groupSeriesMembers(ladderInput(params)));
}

/**
 * The volume ladder a list row draws: one slot per number the series should have, plus the books
 * that carry no usable number, at the end.
 *
 * Two books can sit on the same number - the same volume held in two libraries, or in two formats -
 * and the slot then shows the furthest the user got with either, because that is what "have I read
 * volume four" means to the person asking.
 */
export function buildVolumeLadder(params: {
  members: SeriesMemberRow[];
  truncated: boolean;
  bookCount: number;
  expectedBookCount: number | null;
}): SeriesLadder {
  const { members, bookCount, expectedBookCount } = params;

  if (members.length === 0) {
    return { volumes: [], truncated: params.truncated, gaps: [], chapterGaps: [], next: null, counts: null };
  }

  // A series we could not read in full can still be counted, but naming a volume missing needs
  // every sibling in hand, so a truncated one draws no ladder rather than a wrong one.
  if (params.truncated) {
    return { volumes: [], truncated: true, gaps: [], chapterGaps: [], next: firstOpenMember(members), counts: null };
  }

  const { chapterGaps } = computeSeriesClassGaps(members, expectedBookCount);
  const grouped = groupSeriesMembers(ladderInput({ members, bookCount, expectedBookCount }));
  const { gaps, range, byIndex, unnumbered } = grouped;

  const volumes: SeriesVolumeSlot[] = [];
  let truncated = false;

  if (range) {
    for (let i = range.from; i <= range.to; i++) {
      if (volumes.length >= SERIES_VOLUME_SLOT_LIMIT) {
        truncated = true;
        break;
      }
      const member = byIndex.get(i);
      volumes.push(
        member
          ? { index: i, bookId: member.bookId, title: member.title, status: memberStatus(member.status) }
          : { index: i, bookId: null, title: null, status: 'missing' },
      );
    }
  }

  for (const member of unnumbered) {
    if (volumes.length >= SERIES_VOLUME_SLOT_LIMIT) {
      truncated = true;
      break;
    }
    volumes.push({ index: null, bookId: member.bookId, title: member.title, status: memberStatus(member.status) });
  }

  return { volumes, truncated, gaps, chapterGaps, next: nextFromSlots(volumes, members), counts: tallyVolumes(grouped) };
}

/**
 * The volume to open next: the one already in progress, else the first unread in series order.
 * The raw membership index is reported rather than the slot's, so a half-numbered volume such as
 * 4.5 keeps its number even though the ladder itself only has whole-numbered rungs.
 */
function nextFromSlots(volumes: SeriesVolumeSlot[], members: SeriesMemberRow[]): SeriesLadder['next'] {
  const reading = volumes.find((s) => s.status === 'reading' && s.bookId !== null);
  // A chapter in progress is off the volume ladder but still what the reader is on.
  const readingChapter = reading ? undefined : members.find((m) => m.status === 'reading' && seriesUnitClass(m.unit) === 'chapter');
  if (readingChapter)
    return { bookId: readingChapter.bookId, index: readingChapter.seriesIndex, title: readingChapter.title, unit: readingChapter.unit };
  const slot = reading ?? volumes.find((s) => s.status === 'unread' && s.bookId !== null);
  if (slot?.bookId != null) {
    const member = members.find((m) => m.bookId === slot.bookId);
    return { bookId: slot.bookId, index: member?.seriesIndex ?? null, title: slot.title, unit: member?.unit ?? null };
  }
  // Nothing open inside the drawn ladder; a capped one may still have something past its end.
  return firstOpenMember(members);
}

function firstOpenMember(members: SeriesMemberRow[]): SeriesLadder['next'] {
  const open = members.find((m) => m.status === 'reading') ?? members.find((m) => m.status !== 'read');
  return open ? { bookId: open.bookId, index: open.seriesIndex, title: open.title, unit: open.unit } : null;
}
