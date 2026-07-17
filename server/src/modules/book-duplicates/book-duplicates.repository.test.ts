import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { BookDuplicatesRepository } from './book-duplicates.repository';

const dialect = new PgDialect();

function renderSql(value: unknown) {
  return dialect.sqlToQuery(value as SQL);
}

function queryBuilder<T>(result: T) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & { then?: Promise<T>['then']; getSQL?: () => SQL } = {};
  for (const method of [
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'values',
    'returning',
    'set',
    'innerJoin',
    'groupBy',
    'having',
    'onConflictDoNothing',
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.getSQL = () => sql`select 1`;
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockDb(options: { selectResults?: unknown[]; insertResults?: unknown[]; executeResults?: unknown[] } = {}) {
  const selectResults = [...(options.selectResults ?? [])];
  const insertResults = [...(options.insertResults ?? [])];
  const execute = vi.fn();
  for (const result of options.executeResults ?? []) execute.mockResolvedValueOnce(result);
  execute.mockResolvedValue({ rows: [], rowCount: 0 });

  const db: Record<string, unknown> = {
    select: vi.fn(() => queryBuilder(selectResults.shift() ?? [])),
    insert: vi.fn(() => queryBuilder(insertResults.shift() ?? [])),
    update: vi.fn(() => queryBuilder(undefined)),
    delete: vi.fn(() => queryBuilder(undefined)),
    execute,
  };
  db.transaction = vi.fn((callback: (tx: typeof db) => unknown) => callback(db));
  return db;
}

describe('BookDuplicatesRepository', () => {
  it('builds identical-file keys from the complete ordered content-file signature', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.insertFileHashKeys(9, [1, 2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const query = renderSql(execute.mock.calls[0]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain('array_agg');
    expect(query).toContain('array_to_string');
    expect(query).toContain('file_hash');
    expect(query).toContain('size_bytes');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('count(*) = count(NULLIF(btrim(');
    expect(query).toContain('count(*) = count(');
    expect(query).not.toContain('SELECT DISTINCT');
  });

  it('limits identical-file signatures to content files in accessible, non-processing books', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.insertFileHashKeys(4, [12], { id: 3, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const rendered = renderSql(execute.mock.calls[0]![0]);
    const query = rendered.sql.replace(/\s+/g, ' ');
    expect(query).toContain('library_id');
    expect(query).toContain('status');
    expect(query).toContain('"book_files"."role" = \'content\'');
    expect(rendered.params).toContain('processing');
    expect(rendered.params).toContain(12);
  });

  it('returns only library-relative paths in candidate previews', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.findCandidatePreviews([8], [12], { id: 3, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const query = renderSql(execute.mock.calls[0]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain('rel_path');
    expect(query).toContain('min');
    expect(query).not.toContain('absolute_path');
  });

  it('blocks fuzzy candidates by normalized author and media family before comparing titles', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.createFuzzyPairs(9, [12], { id: 3, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never, 85);

    const rendered = renderSql(execute.mock.calls[0]![0]);
    const query = rendered.sql.replace(/\s+/g, ' ');
    expect(query).toContain('blocked AS');
    expect(query).toContain('a.author_key = b.author_key');
    expect(query).toContain('a.family = b.family');
    expect(query).toContain("author_key <> ''");
    expect(query).toContain('GROUP BY a.book_id, b.book_id');
    expect(rendered.params).toContain(0.85);
  });

  it('persists and retrieves user scan lifecycle state atomically', async () => {
    const created = { id: 9, userId: 7 };
    const db = mockDb({ selectResults: [[], [created], [created], [{ count: 3 }]], insertResults: [[created]] });
    const repo = new BookDuplicatesRepository(db as never);

    await expect(repo.createScanUnlessActive({ userId: 7, libraryIds: [2], requestedLibraryId: 2, similarityPercent: 85 })).resolves.toEqual(created);
    await expect(repo.findActiveForUser(7)).resolves.toEqual(created);
    await expect(repo.findScan(9)).resolves.toEqual(created);
    await expect(repo.countScopedBooks([2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never)).resolves.toBe(3);
    await repo.updateScan(9, { status: 'running' });
    await repo.deleteOlderScans(7, 9);

    expect(db.transaction).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalled();
  });

  it('does not create another scan after the atomic active-scan check', async () => {
    const active = { id: 4, userId: 7 };
    const db = mockDb({ selectResults: [[active]] });
    const repo = new BookDuplicatesRepository(db as never);

    await expect(repo.createScanUnlessActive({ userId: 7, libraryIds: [2], requestedLibraryId: null, similarityPercent: 85 })).resolves.toBeNull();

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('batches ISBN candidates and handles empty and populated key inserts', async () => {
    const rows = [{ id: 8, isbn10: null, isbn13: '9780306406157', formats: ['epub'] }];
    const db = mockDb({ executeResults: [{ rows }] });
    const repo = new BookDuplicatesRepository(db as never);

    await expect(repo.findIsbnBatch([2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never, 0, 500)).resolves.toEqual(
      rows,
    );
    await repo.insertIsbnKeys([]);
    await repo.insertIsbnKeys([{ scanId: 9, bookId: 8, value: '9780306406157|ebook' }]);
    await repo.insertExactMetadataKeys(9, [2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);
    await repo.createExactPairs(9);
    await repo.deleteScanKeys(9);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('cleans interrupted and failed scan artifacts transactionally', async () => {
    const db = mockDb();
    const repo = new BookDuplicatesRepository(db as never);

    await repo.markInterruptedScansFailed();
    await repo.deleteScanArtifacts(9);

    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(6);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('finalizes connected components and returns the persisted group count', async () => {
    const db = mockDb({
      selectResults: [[{ count: 2 }]],
      executeResults: [{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 1 }, { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }],
    });
    const repo = new BookDuplicatesRepository(db as never);

    await expect(repo.finalizeGroups(9)).resolves.toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('paginates only groups with at least two currently accessible members', async () => {
    const groups = [{ id: 5, memberCount: 2 }];
    const db = mockDb({ selectResults: [[], [{ count: 1 }], groups, [{ groupId: 5 }], []] });
    const repo = new BookDuplicatesRepository(db as never);
    const user = { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never;

    await expect(repo.findGroups(9, 1, 20, [2], user, 'isbn')).resolves.toEqual({ groups, total: 1 });
    await expect(repo.findPairs([])).resolves.toEqual([]);
    await expect(repo.findPairs([5])).resolves.toEqual([{ groupId: 5 }]);
    await expect(repo.findCandidatePreviews([], [2], user)).resolves.toEqual([]);
    await expect(repo.findCandidatePreviews([5], [], user)).resolves.toEqual([]);
  });
});
