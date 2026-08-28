import type { SeriesIndex, SeriesVolumeSlot, SeriesVolumeStatus } from '@bookorbit/types';
import { SERIES_VOLUME_SLOT_LIMIT } from '@bookorbit/types';

import type { SeriesMemberRow } from '../series.repository';
import { computeSeriesGaps, resolveLadderRange } from './series-gaps.utils';

export type SeriesLadder = {
  volumes: SeriesVolumeSlot[];
  truncated: boolean;
  gaps: number[];
  next: { bookId: number; index: SeriesIndex | null; title: string | null } | null;
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
    return { volumes: [], truncated: params.truncated, gaps: [], next: null };
  }

  // A series we could not read in full can still be counted, but naming a volume missing needs
  // every sibling in hand, so a truncated one draws no ladder rather than a wrong one.
  if (params.truncated) {
    return { volumes: [], truncated: true, gaps: [], next: firstOpenMember(members) };
  }

  const indices = members.map((m) => m.seriesIndex).filter((idx): idx is string => idx !== null);
  const gaps = computeSeriesGaps(indices, bookCount, expectedBookCount);
  const range = resolveLadderRange(indices, bookCount, expectedBookCount);

  const byIndex = new Map<number, SeriesMemberRow>();
  const unnumbered: SeriesMemberRow[] = [];
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

  return { volumes, truncated, gaps, next: nextFromSlots(volumes, members) };
}

/**
 * The volume to open next: the one already in progress, else the first unread in series order.
 * The raw membership index is reported rather than the slot's, so a half-numbered volume such as
 * 4.5 keeps its number even though the ladder itself only has whole-numbered rungs.
 */
function nextFromSlots(volumes: SeriesVolumeSlot[], members: SeriesMemberRow[]): SeriesLadder['next'] {
  const slot = volumes.find((s) => s.status === 'reading' && s.bookId !== null) ?? volumes.find((s) => s.status === 'unread' && s.bookId !== null);
  if (slot?.bookId != null) {
    const member = members.find((m) => m.bookId === slot.bookId);
    return { bookId: slot.bookId, index: member?.seriesIndex ?? null, title: slot.title };
  }
  // Nothing open inside the drawn ladder; a capped one may still have something past its end.
  return firstOpenMember(members);
}

function firstOpenMember(members: SeriesMemberRow[]): SeriesLadder['next'] {
  const open = members.find((m) => m.status === 'reading') ?? members.find((m) => m.status !== 'read');
  return open ? { bookId: open.bookId, index: open.seriesIndex, title: open.title } : null;
}
