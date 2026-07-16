import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { annotations } from '../../db/schema';
import { DashboardWidgetRepository } from './dashboard-widget.repository';

const dialect = new PgDialect();

function makeCountQuery(rows: { count: number }[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

function makeOffsetQuery(
  rows: {
    text: string;
    note: string | null;
    bookTitle: string;
    bookId: number;
    coverSource: string | null;
    chapterTitle: string | null;
    createdAt: Date;
  }[],
) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
  return query;
}

function expectActiveAnnotationPool(where: unknown, userId: number, libraryIds: number[]): void {
  const rendered = dialect.sqlToQuery(where as SQL);

  expect(rendered.sql).toContain('"annotations"."user_id" = $1');
  expect(rendered.sql).toContain('"annotations"."deleted_at" is null');
  expect(rendered.sql).toContain('"books"."library_id" in ($2, $3)');
  expect(rendered.params).toEqual([userId, ...libraryIds]);
}

describe('DashboardWidgetRepository highlight queries', () => {
  it('does not query when the user has no accessible libraries', async () => {
    const db = { select: vi.fn() };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.getAnnotationCount(42, [])).resolves.toBe(0);
    await expect(repository.getAnnotationByOffset(42, [], 0)).resolves.toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('counts only active annotations in the user and library scoped pool', async () => {
    const query = makeCountQuery([{ count: 2 }]);
    const db = { select: vi.fn().mockReturnValue(query) };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.getAnnotationCount(42, [7, 8])).resolves.toBe(2);

    expectActiveAnnotationPool(query.where.mock.calls[0]?.[0], 42, [7, 8]);
  });

  it('returns zero when the active annotation count query has no row', async () => {
    const query = makeCountQuery([]);
    const db = { select: vi.fn().mockReturnValue(query) };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.getAnnotationCount(42, [7, 8])).resolves.toBe(0);
    expectActiveAnnotationPool(query.where.mock.calls[0]?.[0], 42, [7, 8]);
  });

  it('selects by offset from the same active annotation pool used by the count', async () => {
    const createdAt = new Date('2026-07-01T12:00:00.000Z');
    const query = makeOffsetQuery([
      {
        text: 'Second active highlight',
        note: 'A note',
        bookTitle: 'Test Book',
        bookId: 11,
        coverSource: 'embedded',
        chapterTitle: 'Chapter 2',
        createdAt,
      },
    ]);
    const db = { select: vi.fn().mockReturnValue(query) };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.getAnnotationByOffset(42, [7, 8], 1)).resolves.toEqual({
      text: 'Second active highlight',
      note: 'A note',
      bookTitle: 'Test Book',
      bookId: 11,
      hasCover: true,
      chapterTitle: 'Chapter 2',
      createdAt: createdAt.toISOString(),
    });

    expectActiveAnnotationPool(query.where.mock.calls[0]?.[0], 42, [7, 8]);
    expect(query.orderBy).toHaveBeenCalledWith(annotations.id);
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.offset).toHaveBeenCalledWith(1);
  });

  it('returns null when an active annotation no longer exists at the selected offset', async () => {
    const query = makeOffsetQuery([]);
    const db = { select: vi.fn().mockReturnValue(query) };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.getAnnotationByOffset(42, [7, 8], 1)).resolves.toBeNull();
    expectActiveAnnotationPool(query.where.mock.calls[0]?.[0], 42, [7, 8]);
  });
});
