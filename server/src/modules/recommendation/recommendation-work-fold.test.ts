import { describe, expect, it } from 'vitest';

import { foldWorks, type WorkFoldRow } from './recommendation-work-fold';

function row(bookId: number, workKey: string | null, extra: Partial<WorkFoldRow> = {}): WorkFoldRow {
  return { bookId, workKey, status: 'present', lastReadAt: null, leadBookId: null, ...extra };
}

describe('foldWorks', () => {
  it('keeps books outside any group as they are', () => {
    const rows = [row(1, 'b1'), row(2, 'b2'), row(3, null)];
    expect(foldWorks(rows, 10).map((r) => r.bookId)).toEqual([1, 2, 3]);
  });

  it('shows a work once, at the place of its first edition', () => {
    const rows = [row(1, 'g7', { leadBookId: 3 }), row(2, 'b2'), row(3, 'g7', { leadBookId: 3 })];
    expect(foldWorks(rows, 10).map((r) => r.bookId)).toEqual([3, 2]);
  });

  it('prefers the open book over every other edition of its work', () => {
    const rows = [row(1, 'g7', { leadBookId: 1, lastReadAt: '2026-11-01T00:00:00Z' }), row(2, 'g7', { leadBookId: 1 })];
    expect(foldWorks(rows, 10, 2).map((r) => r.bookId)).toEqual([2]);
  });

  it('prefers a present edition, then the one read last, then the lead, then the lowest id', () => {
    const missing = [row(1, 'g1', { status: 'missing', lastReadAt: '2026-11-02T00:00:00Z' }), row(2, 'g1')];
    expect(foldWorks(missing, 10)[0]!.bookId).toBe(2);

    const read = [row(1, 'g1', { leadBookId: 1 }), row(2, 'g1', { leadBookId: 1, lastReadAt: new Date('2026-11-02T00:00:00Z') })];
    expect(foldWorks(read, 10)[0]!.bookId).toBe(2);

    const lead = [row(1, 'g1', { leadBookId: 2 }), row(2, 'g1', { leadBookId: 2 })];
    expect(foldWorks(lead, 10)[0]!.bookId).toBe(2);

    const lowest = [row(5, 'g1'), row(4, 'g1')];
    expect(foldWorks(lowest, 10)[0]!.bookId).toBe(4);
  });

  it('stops at the limit of works but still lets a later edition replace a kept one', () => {
    const rows = [row(1, 'g1', { leadBookId: 3 }), row(2, 'b2'), row(9, 'b9'), row(3, 'g1', { leadBookId: 3 })];
    expect(foldWorks(rows, 2).map((r) => r.bookId)).toEqual([3, 2]);
  });
});
