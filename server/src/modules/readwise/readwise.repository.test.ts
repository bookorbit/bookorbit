import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Permission } from '@bookorbit/types';

import { ReadwiseRepository } from './readwise.repository';

function makeReturningChain(row: unknown) {
  const chain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.returning.mockResolvedValue([row]);
  return chain;
}

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'leftJoin', 'where', 'groupBy', 'orderBy']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue(rows);
  return chain;
}

function makeRepository() {
  const settingsRow = {
    id: 1,
    userId: 7,
    apiToken: 'tok',
    enabled: true,
    lastSyncedAnnotationId: 0,
    disabledReason: null,
    lastSyncedAt: null,
  };

  const settingsQuery = { findFirst: vi.fn().mockResolvedValue(settingsRow) };
  const settingsInsert = makeReturningChain(settingsRow);

  const permissionLimit = vi.fn().mockResolvedValue([{ isSuperuser: false, permissionName: Permission.ReadwiseSync }]);
  const permissionWhere = vi.fn().mockReturnValue({ limit: permissionLimit });
  const permissionLeftJoin = vi.fn().mockReturnValue({ where: permissionWhere });
  const permissionFrom = vi.fn().mockReturnValue({ leftJoin: permissionLeftJoin });

  const db = {
    query: {
      readwiseUserSettings: settingsQuery,
    },
    insert: vi.fn().mockReturnValue(settingsInsert),
    select: vi.fn().mockReturnValue({ from: permissionFrom }),
  };

  return {
    repo: new ReadwiseRepository(db as never),
    db,
    settingsQuery,
    settingsInsert,
    permissionFrom,
    permissionLimit,
    settingsRow,
  };
}

describe('ReadwiseRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('findSettings returns the user settings row', async () => {
    const { repo, settingsQuery, settingsRow } = makeRepository();

    await expect(repo.findSettings(7)).resolves.toEqual(settingsRow);
    expect(settingsQuery.findFirst).toHaveBeenCalledTimes(1);
  });

  it('upsertSettings inserts or updates settings for a user', async () => {
    const { repo, db, settingsInsert, settingsRow } = makeRepository();
    db.insert.mockReset();
    db.insert.mockReturnValue(settingsInsert);

    await expect(repo.upsertSettings(7, { apiToken: 'tok' })).resolves.toEqual(settingsRow);
    expect(settingsInsert.values).toHaveBeenCalledWith({ userId: 7, apiToken: 'tok' });
    expect(settingsInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({ apiToken: 'tok', updatedAt: expect.any(Date) }),
      }),
    );
  });

  it('findLatestAnnotationId returns the max user annotation id', async () => {
    const { repo, db } = makeRepository();
    db.select.mockReturnValueOnce(makeSelectChain([{ latestAnnotationId: 99 }]));

    await expect(repo.findLatestAnnotationId(7)).resolves.toBe(99);
  });

  it('userHasReadwiseSyncPermission returns true for a superuser', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: true, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasReadwiseSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasReadwiseSyncPermission returns true for a user with the permission', async () => {
    const { repo, db, permissionFrom } = makeRepository();
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasReadwiseSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasReadwiseSyncPermission returns false without a matching permission row', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: false, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasReadwiseSyncPermission(7)).resolves.toBe(false);
  });

  it('findNewHighlights maps rows and joins the authors csv into a single author string', async () => {
    const { repo, db } = makeRepository();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const rows = [
      {
        annotationId: 10,
        bookId: 42,
        text: 'A highlight',
        note: 'my note',
        createdAt,
        title: 'Dune',
        isbn13: '9780441172719',
        isbn10: '0441172717',
        authorsCsv: 'Frank Herbert||Brian Herbert',
      },
      {
        annotationId: 11,
        bookId: 43,
        text: 'Another highlight',
        note: null,
        createdAt,
        title: null,
        isbn13: null,
        isbn10: null,
        authorsCsv: '',
      },
    ];
    db.select.mockReturnValueOnce(makeSelectChain(rows));

    await expect(repo.findNewHighlights(7, 0, 100)).resolves.toEqual([
      {
        annotationId: 10,
        bookId: 42,
        text: 'A highlight',
        note: 'my note',
        createdAt,
        title: 'Dune',
        isbn13: '9780441172719',
        isbn10: '0441172717',
        author: 'Frank Herbert, Brian Herbert',
      },
      {
        annotationId: 11,
        bookId: 43,
        text: 'Another highlight',
        note: null,
        createdAt,
        title: null,
        isbn13: null,
        isbn10: null,
        author: '',
      },
    ]);
  });
});
