import type { ReadStatus } from '@bookorbit/types';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KoboStatusProjectionRepository, toKoboReadingStatus } from './kobo-status-projection.repository';

const dialect = new PgDialect();

function renderSql(value: unknown) {
  return dialect.sqlToQuery(value as SQL);
}

function makeDb(options: { twoWayProgressSync?: boolean; changedBookIds?: number[][] } = {}) {
  const limit = vi.fn().mockResolvedValue(options.twoWayProgressSync === undefined ? [] : [{ twoWayProgressSync: options.twoWayProgressSync }]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });

  const execute = vi.fn();
  for (const bookIds of options.changedBookIds ?? []) {
    execute.mockResolvedValueOnce({ rows: bookIds.map((book_id) => ({ book_id })) });
    execute.mockResolvedValueOnce({ rows: [] });
  }
  execute.mockResolvedValue({ rows: [] });

  return { select: vi.fn().mockReturnValue({ from }), execute, from, where, limit };
}

/** Statements are issued in pairs: the reading-state upsert, then the snapshot invalidation. */
function upsertStatements(db: ReturnType<typeof makeDb>) {
  return db.execute.mock.calls.filter((_call, index) => index % 2 === 0).map(([statement]) => renderSql(statement));
}

function unsyncStatements(db: ReturnType<typeof makeDb>) {
  return db.execute.mock.calls.filter((_call, index) => index % 2 === 1).map(([statement]) => renderSql(statement));
}

/** Book ids are the only bound parameters rendered as a standalone `($n::integer)` row. */
function countValueRows(statement: string) {
  return statement.match(/\(\$\d+::integer\)/g)?.length ?? 0;
}

let db: ReturnType<typeof makeDb>;
let repo: KoboStatusProjectionRepository;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb({ changedBookIds: [[10]] });
  repo = new KoboStatusProjectionRepository(db as never);
});

describe('toKoboReadingStatus', () => {
  it.each([
    ['unread', 'ReadyToRead'],
    ['want_to_read', 'ReadyToRead'],
    ['reading', 'Reading'],
    ['on_hold', 'Reading'],
    ['rereading', 'Reading'],
    ['abandoned', 'Reading'],
    ['read', 'Finished'],
    ['skimmed', 'Finished'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(toKoboReadingStatus(status)).toBe(expected);
  });

  it('covers every read status', () => {
    const statuses: ReadStatus[] = ['unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'];
    for (const status of statuses) {
      expect(['ReadyToRead', 'Reading', 'Finished']).toContain(toKoboReadingStatus(status));
    }
  });
});

describe('isEnabled', () => {
  it('is true only when two-way progress sync is on', async () => {
    repo = new KoboStatusProjectionRepository(makeDb({ twoWayProgressSync: true }) as never);
    await expect(repo.isEnabled(1)).resolves.toBe(true);
  });

  it('is false when two-way progress sync is off', async () => {
    repo = new KoboStatusProjectionRepository(makeDb({ twoWayProgressSync: false }) as never);
    await expect(repo.isEnabled(1)).resolves.toBe(false);
  });

  it('is false when the user has no Kobo sync settings row', async () => {
    repo = new KoboStatusProjectionRepository(makeDb() as never);
    await expect(repo.isEnabled(1)).resolves.toBe(false);
  });
});

describe('project', () => {
  it('writes nothing for an empty book list', async () => {
    await expect(repo.project(1, [], 'read')).resolves.toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns the book ids whose Kobo status changed', async () => {
    await expect(repo.project(1, [10], 'read')).resolves.toEqual([10]);
  });

  it('writes the mapped Kobo status and scopes the upsert to the owning user', async () => {
    await repo.project(7, [10], 'read');

    const [upsert] = upsertStatements(db);
    expect(upsert!.sql).toContain('INSERT INTO "kobo_reading_states"');
    expect(upsert!.sql).toContain('RETURNING book_id');
    expect(upsert!.params).toContain('Finished');
    expect(upsert!.params).toContain(7);
  });

  it('only updates StatusInfo so the reading bookmark stays owned by progress', async () => {
    await repo.project(1, [10], 'read');

    const [upsert] = upsertStatements(db);
    const conflictClause = upsert!.sql.slice(upsert!.sql.indexOf('ON CONFLICT'));
    expect(conflictClause).toContain('status_info');
    expect(conflictClause).not.toContain('current_bookmark');
    expect(conflictClause).not.toContain('statistics');
  });

  it('merges into the existing StatusInfo so device counters survive', async () => {
    await repo.project(1, [10], 'read');

    const [upsert] = upsertStatements(db);
    expect(upsert!.sql).toContain(`COALESCE("kobo_reading_states".status_info, '{}'::jsonb)`);
  });

  it('bumps the envelope timestamps the device uses to resolve conflicts', async () => {
    await repo.project(1, [10], 'read');

    const [upsert] = upsertStatements(db);
    const conflictClause = upsert!.sql.slice(upsert!.sql.indexOf('ON CONFLICT'));
    expect(conflictClause).toContain('last_modified_kobo');
    expect(conflictClause).toContain('priority_timestamp');
  });

  it('skips rows whose Kobo status already matches', async () => {
    await repo.project(1, [10], 'read');

    const [upsert] = upsertStatements(db);
    expect(upsert!.sql).toContain(`COALESCE("kobo_reading_states".status_info->>'Status', '') IS DISTINCT FROM`);
  });

  it('restricts the projection to Kobo-deliverable primary files', async () => {
    await repo.project(1, [10], 'read');

    const [upsert] = upsertStatements(db);
    expect(upsert!.sql).toContain('bf.id = bk.primary_file_id');
    expect(upsert!.sql).toContain(`bf.format IN ('epub', 'kepub')`);
  });

  it('marks only unsynced-eligible snapshot rows for the books that changed', async () => {
    await repo.project(1, [10], 'read');

    const [unsync] = unsyncStatements(db);
    expect(unsync!.sql).toContain('UPDATE "kobo_device_snapshot_books"');
    expect(unsync!.sql).toContain('synced = false');
    expect(unsync!.sql).toContain('is_new = false');
    expect(unsync!.sql).toContain('sb.pending_delete = false');
    expect(unsync!.sql).toContain('sb.removed_by_device = false');
    expect(unsync!.params).toContain(10);
  });

  it('does not touch device snapshots when no Kobo status changed', async () => {
    db = makeDb({ changedBookIds: [[]] });
    repo = new KoboStatusProjectionRepository(db as never);

    await expect(repo.project(1, [10], 'read')).resolves.toEqual([]);

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('deduplicates book ids so the upsert cannot hit the same row twice', async () => {
    db = makeDb({ changedBookIds: [[10]] });
    repo = new KoboStatusProjectionRepository(db as never);

    await repo.project(1, [10, 10, 10], 'read');

    const [upsert] = upsertStatements(db);
    expect(upsert!.params.filter((param) => param === 10)).toHaveLength(1);
  });

  it('batches large book lists instead of building one unbounded statement', async () => {
    const bookIds = Array.from({ length: 1200 }, (_value, index) => index + 1);
    db = makeDb({ changedBookIds: [bookIds.slice(0, 500), bookIds.slice(500, 1000), bookIds.slice(1000)] });
    repo = new KoboStatusProjectionRepository(db as never);

    await expect(repo.project(1, bookIds, 'read')).resolves.toEqual(bookIds);

    const upserts = upsertStatements(db);
    expect(upserts).toHaveLength(3);
    expect(countValueRows(upserts[0]!.sql)).toBe(500);
    expect(countValueRows(upserts[1]!.sql)).toBe(500);
    expect(countValueRows(upserts[2]!.sql)).toBe(200);
  });
});
