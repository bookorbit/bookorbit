import { describe, expect, it } from 'vitest';

import type { SeriesMemberRow } from '../series.repository';
import { computeSeriesGaps, resolveLadderRange } from './series-gaps.utils';
import { buildVolumeLadder } from './series-ladder.utils';

function member(bookId: number, seriesIndex: string | null, status: string | null = null, title = `Book ${bookId}`): SeriesMemberRow {
  return { bookId, seriesIndex, title, status };
}

function build(members: SeriesMemberRow[], opts: { expected?: number | null; truncated?: boolean; bookCount?: number } = {}) {
  return buildVolumeLadder({
    members,
    truncated: opts.truncated ?? false,
    bookCount: opts.bookCount ?? members.length,
    expectedBookCount: opts.expected ?? null,
  });
}

const marks = (ladder: ReturnType<typeof build>) => ladder.volumes.map((v) => v.status).join(',');

describe('buildVolumeLadder', () => {
  it('draws one rung per number between the lowest and highest it holds', () => {
    const ladder = build([member(1, '1', 'read'), member(2, '2', 'reading'), member(3, '4')]);

    expect(marks(ladder)).toBe('read,reading,missing,unread');
    expect(ladder.volumes.map((v) => v.index)).toEqual([1, 2, 3, 4]);
    expect(ladder.gaps).toEqual([3]);
  });

  it('never names a rung the gap finder would not name', () => {
    const cases: { members: SeriesMemberRow[]; expected: number | null }[] = [
      { members: [member(1, '1'), member(2, '3')], expected: null },
      { members: [member(1, '2')], expected: 4 },
      { members: [member(1, '1'), member(2, '2')], expected: 5 },
      { members: [member(1, '1'), member(2, 'x')], expected: 3 },
      { members: [member(1, '0'), member(2, '2')], expected: null },
      { members: [member(1, '1'), member(2, '1.5'), member(3, '2')], expected: null },
    ];

    for (const { members, expected } of cases) {
      const ladder = build(members, { expected });
      const gapsFromLadder = ladder.volumes.filter((v) => v.status === 'missing').map((v) => v.index);
      const indices = members.map((m) => m.seriesIndex).filter((i): i is string => i !== null);
      expect(gapsFromLadder).toEqual(computeSeriesGaps(indices, members.length, expected));
      expect(ladder.gaps).toEqual(computeSeriesGaps(indices, members.length, expected));
    }
  });

  it('runs the ladder from one when a provider total can be trusted', () => {
    const ladder = build([member(1, '2', 'read'), member(2, '3')], { expected: 4 });

    expect(marks(ladder)).toBe('missing,read,unread,missing');
    expect(ladder.gaps).toEqual([1, 4]);
  });

  it('ignores a provider total that the shelf itself contradicts', () => {
    const ladder = build([member(1, '5'), member(2, '6')], { expected: 3 });

    expect(marks(ladder)).toBe('unread,unread');
    expect(ladder.gaps).toEqual([]);
  });

  it('collapses two copies of a volume onto one rung and keeps the furthest read', () => {
    const ladder = build([member(1, '1'), member(2, '1', 'read'), member(3, '2', 'reading'), member(4, '2')]);

    expect(marks(ladder)).toBe('read,reading');
    expect(ladder.volumes[0]!.bookId).toBe(2);
  });

  it('puts books with no usable number after the numbered rungs', () => {
    const ladder = build([member(1, '1', 'read'), member(2, null), member(3, '2.5', 'reading')]);

    expect(ladder.volumes.map((v) => v.index)).toEqual([1, null, null]);
    expect(marks(ladder)).toBe('read,unread,reading');
  });

  it('draws no ladder at all when nothing carries a usable number', () => {
    const ladder = build([member(1, null, 'read'), member(2, null)]);

    expect(ladder.volumes.map((v) => v.index)).toEqual([null, null]);
    expect(ladder.gaps).toEqual([]);
    expect(resolveLadderRange([], 2, null)).toBeUndefined();
  });

  it('refuses to draw a ladder for a series it could not read in full', () => {
    const ladder = build([member(1, '1'), member(2, '9')], { truncated: true, bookCount: 900 });

    expect(ladder.volumes).toEqual([]);
    expect(ladder.truncated).toBe(true);
    expect(ladder.gaps).toEqual([]);
    expect(ladder.next?.bookId).toBe(1);
  });

  it('caps a very long ladder and says so', () => {
    const members = Array.from({ length: 80 }, (_, i) => member(i + 1, String(i + 1)));
    const ladder = build(members);

    expect(ladder.volumes).toHaveLength(60);
    expect(ladder.truncated).toBe(true);
  });

  describe('next volume', () => {
    it('prefers the one already in progress over an earlier unread one', () => {
      const ladder = build([member(1, '1'), member(2, '2', 'reading')]);
      expect(ladder.next).toEqual({ bookId: 2, index: '2', title: 'Book 2' });
    });

    it('falls back to the first unread in series order', () => {
      const ladder = build([member(1, '1', 'read'), member(2, '2'), member(3, '3')]);
      expect(ladder.next?.bookId).toBe(2);
    });

    it('keeps a half number rather than rounding it onto a rung', () => {
      const ladder = build([member(1, '1', 'read'), member(2, '1.5')]);
      expect(ladder.next).toEqual({ bookId: 2, index: '1.5', title: 'Book 2' });
    });

    it('is null once every volume is read', () => {
      const ladder = build([member(1, '1', 'read'), member(2, '2', 'read')]);
      expect(ladder.next).toBeNull();
    });
  });
});
