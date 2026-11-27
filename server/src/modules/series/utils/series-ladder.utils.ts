import type { SeriesGapPosition, SeriesIndex, SeriesUnit, SeriesVolumeSlot, SeriesVolumeStatus } from '@bookorbit/types';
import { SERIES_VOLUME_SLOT_LIMIT, seriesRunOf, seriesUnitClass } from '@bookorbit/types';

import type { SeriesMemberRow, SeriesVolumeMember } from '../series.repository';
import { computeSeriesClassGaps, computeSeriesGaps, resolveLadderRange, splitSeriesRuns } from './series-gaps.utils';

export type SeriesVolumeCounts = {
  ownedVolumeCount: number;
  readVolumeCount: number;
  readingVolumeCount: number;
};

export type SeriesLadder = {
  volumes: SeriesVolumeSlot[];
  truncated: boolean;
  gaps: number[];
  /** Chapter or issue numbers missing between the lowest and highest owned; empty across several runs. */
  chapterGaps: number[];
  /** Missing chapters and issues with their run. */
  chapterGapPositions: SeriesGapPosition[];
  next: { bookId: number; index: SeriesIndex | null; title: string | null; unit: SeriesUnit | null; volumeIndex: SeriesIndex | null } | null;
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

type GroupedRun<T> = {
  run: string | null;
  gaps: number[];
  range: { from: number; to: number } | undefined;
  byIndex: Map<number, T>;
  unnumbered: T[];
};

function groupRun<T extends SeriesVolumeMember>(
  run: string | null,
  members: T[],
  bookCount: number,
  expectedBookCount: number | null,
): GroupedRun<T> {
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

  return { run, gaps, range, byIndex, unnumbered };
}

/**
 * The line's members grouped run by run. Issue numbers restart in each run of a comic, so v2 #1 and
 * v3 #1 are two books, each run has its own range and gaps, and a provider total never applies to a
 * line split into runs. A volume line is one run.
 */
function groupSeriesMembers<T extends SeriesVolumeMember>(params: {
  members: T[];
  bookCount: number;
  expectedBookCount: number | null;
}): {
  runs: GroupedRun<T>[];
  /** The line's missing numbers when it is one run; empty across several, where a bare number names no run. */
  gaps: number[];
} {
  const split = splitSeriesRuns(params.members);
  if (split.length <= 1) {
    const only = groupRun(split[0]?.run ?? null, params.members, params.bookCount, params.expectedBookCount);
    return { runs: [only], gaps: only.gaps };
  }
  return { runs: split.map(({ run, members }) => groupRun(run, members, members.length, null)), gaps: [] };
}

function tallyVolumes(grouped: { runs: readonly GroupedRun<SeriesVolumeMember>[] }): SeriesVolumeCounts {
  const statuses = grouped.runs.flatMap((run) => [...run.byIndex.values(), ...run.unnumbered]).map((member) => memberStatus(member.status));

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
    return { volumes: [], truncated: params.truncated, gaps: [], chapterGaps: [], chapterGapPositions: [], next: null, counts: null };
  }

  // A series we could not read in full can still be counted, but naming a volume missing needs
  // every sibling in hand, so a truncated one draws no ladder rather than a wrong one.
  if (params.truncated) {
    return { volumes: [], truncated: true, gaps: [], chapterGaps: [], chapterGapPositions: [], next: firstOpenMember(members), counts: null };
  }

  const { chapterGaps, chapterGapPositions } = computeSeriesClassGaps(members, expectedBookCount);
  const grouped = groupSeriesMembers(ladderInput({ members, bookCount, expectedBookCount }));

  const volumes: SeriesVolumeSlot[] = [];
  let truncated = false;
  const push = (slot: SeriesVolumeSlot): boolean => {
    if (volumes.length >= SERIES_VOLUME_SLOT_LIMIT) {
      truncated = true;
      return false;
    }
    volumes.push(slot);
    return true;
  };

  // Each run's rungs in run order, then every book that carries no usable number.
  fill: for (const { run, range, byIndex } of grouped.runs) {
    if (!range) continue;
    const inRun = run === null ? {} : { volumeIndex: run };
    for (let i = range.from; i <= range.to; i++) {
      const member = byIndex.get(i);
      const slot: SeriesVolumeSlot = member
        ? { index: i, ...inRun, bookId: member.bookId, title: member.title, status: memberStatus(member.status) }
        : { index: i, ...inRun, bookId: null, title: null, status: 'missing' };
      if (!push(slot)) break fill;
    }
  }
  if (!truncated) {
    for (const member of grouped.runs.flatMap((run) => run.unnumbered)) {
      const run = seriesRunOf(member.unit, member.volumeIndex);
      const slot: SeriesVolumeSlot = {
        index: null,
        ...(run === null ? {} : { volumeIndex: run }),
        bookId: member.bookId,
        title: member.title,
        status: memberStatus(member.status),
      };
      if (!push(slot)) break;
    }
  }

  return {
    volumes,
    truncated,
    gaps: grouped.gaps,
    chapterGaps,
    chapterGapPositions,
    next: nextFromSlots(volumes, members),
    counts: tallyVolumes(grouped),
  };
}

function nextOf(member: SeriesMemberRow): NonNullable<SeriesLadder['next']> {
  return {
    bookId: member.bookId,
    index: member.seriesIndex,
    title: member.title,
    unit: member.unit,
    volumeIndex: seriesRunOf(member.unit, member.volumeIndex),
  };
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
  if (readingChapter) return nextOf(readingChapter);
  const slot = reading ?? volumes.find((s) => s.status === 'unread' && s.bookId !== null);
  if (slot?.bookId != null) {
    const member = members.find((m) => m.bookId === slot.bookId);
    return member ? { ...nextOf(member), title: slot.title } : { bookId: slot.bookId, index: null, title: slot.title, unit: null, volumeIndex: null };
  }
  // Nothing open inside the drawn ladder; a capped one may still have something past its end.
  return firstOpenMember(members);
}

function firstOpenMember(members: SeriesMemberRow[]): SeriesLadder['next'] {
  const open = members.find((m) => m.status === 'reading') ?? members.find((m) => m.status !== 'read');
  return open ? nextOf(open) : null;
}
