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
    'leftJoin',
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

/** A db whose transactions run on the same `execute`, so a scan stage's `SET LOCAL` and its statement are both recorded. */
function transactionalDb(execute: ReturnType<typeof vi.fn>) {
  return { execute, transaction: vi.fn((callback: (tx: { execute: typeof execute }) => unknown) => callback({ execute })) } as never;
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
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.insertFileHashKeys(9, [1, 2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const query = renderSql(execute.mock.calls[1]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain('array_agg');
    expect(query).toContain('array_to_string');
    expect(query).toContain('file_hash');
    expect(query).toContain('size_bytes');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('count(*) = count(NULLIF(btrim(');
    expect(query).toContain('count(*) = count(');
    expect(query).not.toContain('SELECT DISTINCT');
  });

  it('hashes the file-hash signature with md5 so the stored value stays within the btree index limit (regression: #762)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.insertFileHashKeys(9, [1, 2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const query = renderSql(execute.mock.calls[1]![0]).sql.replace(/\s+/g, ' ');
    // A book with an arbitrarily large number of content files (e.g. a chapterized
    // audiobook) must never write its full, unbounded concatenated signature as the
    // indexed `value` - only its fixed-size md5 digest.
    expect(query).toMatch(/'file_hash',\s*md5\(\s*array_to_string\(\s*array_agg\(/);
    expect(query.indexOf('md5(')).toBeLessThan(query.indexOf('array_to_string('));
    expect(query.match(/\bmd5\(/g)).toHaveLength(1);
  });

  it('hashes the exact-metadata signature with md5 so an unbounded author list cannot overflow the btree index (regression: #762)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.insertExactMetadataKeys(9, [1, 2], { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const query = renderSql(execute.mock.calls[1]![0]).sql.replace(/\s+/g, ' ');
    // A book with an arbitrarily large author list (e.g. an anthology) must never write
    // the raw title|authors|family concatenation as the indexed `value` - only its
    // fixed-size md5 digest.
    expect(query).toContain(
      "'exact_metadata', md5(eligible.title_key || chr(31) || array_to_string(eligible.author_keys, chr(30)) || chr(31) || family)",
    );
    expect(query.match(/\bmd5\(/g)).toHaveLength(1);
    expect(query).toContain("'pdf', 'djvu'");
  });

  it('limits identical-file signatures to content files in accessible, non-processing books', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.insertFileHashKeys(4, [12], { id: 3, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never);

    const rendered = renderSql(execute.mock.calls[1]![0]);
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
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.createFuzzyPairs(9, [12], { id: 3, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never, 85);

    const rendered = renderSql(execute.mock.calls[1]![0]);
    const query = rendered.sql.replace(/\s+/g, ' ');
    expect(query).toContain('blocked AS');
    expect(query).toContain('a.author_key = b.author_key');
    expect(query).toContain('a.family = b.family');
    expect(query).toContain("'pdf', 'djvu'");
    expect(query).toContain("author_key <> ''");
    expect(query).toContain('GROUP BY a.book_id, b.book_id');
    expect(rendered.params).toContain(0.85);
  });

  it('refreshes PostgreSQL statistics for populated duplicate scan keys', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await repo.analyzeScanKeys();

    expect(renderSql(execute.mock.calls[0]![0]).sql).toBe('SET LOCAL lock_timeout = 5000');
    const rendered = renderSql(execute.mock.calls[1]![0]);
    expect(rendered.sql.trim()).toBe('ANALYZE "book_duplicate_scan_keys"');
    expect(rendered.params).toEqual([]);
  });

  it('joins ebook and audiobook keys through the indexed value without changing pair rules', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 2 });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await expect(repo.createOtherFormatPairs(9, 90)).resolves.toBe(2);

    expect(renderSql(execute.mock.calls[0]![0]).sql).toBe('SET LOCAL statement_timeout = 600000');
    const rendered = renderSql(execute.mock.calls[1]![0]);
    const query = rendered.sql.replace(/\s+/g, ' ');
    expect(query).toContain('FROM "book_duplicate_scan_keys" ebook_keys JOIN "book_duplicate_scan_keys" audio_keys');
    expect(query).toContain('audio_keys.scan_id = ebook_keys.scan_id');
    expect(query).toContain('audio_keys.kind = ebook_keys.kind');
    expect(query).toContain("audio_keys.value = 'a|' || substr(ebook_keys.value, 3)");
    expect(query).toContain("ebook_keys.value LIKE 'e|%'");
    expect(query).toContain("ebook_keys.kind IN ('of_work', 'of_title', 'of_series')");
    expect(query).toContain("WHEN 'of_work' THEN 'same_work'");
    expect(query).toContain("WHEN 'of_title' THEN 'title_author'");
    expect(query).toContain("WHEN matched.kind = 'of_series' THEN similarity(");
    expect(query).toContain("scored.reason <> 'series_position' OR scored.title_similarity >=");
    expect(query).toContain('FROM book_links link_a JOIN book_links link_b ON link_b.group_id = link_a.group_id');
    expect(query).not.toContain('substr(audio_keys.value, 3)');
    expect(rendered.params).toEqual([9, 9, 0.9]);
  });

  it('pairs same-medium books by shared work id as edition candidates, leaving duplicate pairs to the duplicate passes', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 4 });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await expect(repo.createSameMediumWorkPairs(9)).resolves.toBe(4);

    expect(renderSql(execute.mock.calls[0]![0]).sql).toBe('SET LOCAL statement_timeout = 600000');
    const query = renderSql(execute.mock.calls[1]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain("first_key.kind = 'of_work'");
    expect(query).toContain('second_key.value = first_key.value');
    expect(query).toContain('second_key.book_id > first_key.book_id');
    expect(query).toContain("'other_edition', matched.book_id_a, matched.book_id_b, ARRAY['same_work']::text[]");
    expect(query).toContain("existing.kind = 'duplicate'");
  });

  it('removes pairs of books already linked together from every kind', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 2 });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await expect(repo.deleteLinkedPairs(9)).resolves.toBe(2);

    const query = renderSql(execute.mock.calls[1]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain('DELETE FROM "book_duplicate_pairs" pair WHERE pair.scan_id = $1 AND EXISTS');
    expect(query).toContain('JOIN book_links link_b ON link_b.group_id = link_a.group_id');
    expect(query).not.toContain('pair.kind');
  });

  it('pages edition candidates by pair key and never offers identical files or a shared ISBN', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.findEditionCandidatePairs(9, { bookIdA: 3, bookIdB: 8 }, 500);

    const rendered = renderSql(execute.mock.calls[0]![0]);
    const query = rendered.sql.replace(/\s+/g, ' ');
    expect(query).toContain("pair.kind = 'other_edition'");
    expect(query).toContain("NOT ('file_hash' = ANY(pair.reasons)) AND NOT ('isbn' = ANY(pair.reasons))");
    expect(query).toContain('(pair.book_id_a, pair.book_id_b) > ($2::integer, $3::integer)');
    expect(query).toContain('ORDER BY pair.book_id_a, pair.book_id_b LIMIT $4');
    expect(rendered.params).toEqual([9, 3, 8, 500]);
  });

  it('moves reclassified pairs and drops rejected candidates in one statement each', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await repo.applyEditionOutcomes(9, [{ bookIdA: 1, bookIdB: 2, sameWork: true }], [{ bookIdA: 5, bookIdB: 6 }]);

    expect(execute).toHaveBeenCalledTimes(2);
    const update = renderSql(execute.mock.calls[0]![0]);
    expect(update.sql.replace(/\s+/g, ' ')).toContain("SET kind = 'other_edition'");
    expect(update.sql.replace(/\s+/g, ' ')).toContain("pair.kind = 'duplicate'");
    expect(update.params).toEqual([[1], [2], [true], 9]);
    const remove = renderSql(execute.mock.calls[1]![0]);
    expect(remove.sql.replace(/\s+/g, ' ')).toContain("pair.kind = 'other_edition'");
    expect(remove.params).toEqual([[5], [6], 9]);

    execute.mockClear();
    await repo.applyEditionOutcomes(9, [], []);
    expect(execute).not.toHaveBeenCalled();
  });

  it('turns every other-edition pair into a group of its own', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const repo = new BookDuplicatesRepository(transactionalDb(execute));

    await expect(repo.finalizeOtherEditionGroups(9)).resolves.toBe(3);

    const rendered = renderSql(execute.mock.calls[1]![0]);
    expect(rendered.sql.replace(/\s+/g, ' ')).toContain('pair.kind = $2');
    expect(rendered.params.filter((param) => param === 'other_edition')).toHaveLength(3);
    expect(rendered.params).not.toContain('other_format');
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

  it('finalizes groups from the guarded pairs and drops a pair the grouping refused', async () => {
    const db = mockDb({
      selectResults: [[{ count: 1 }]],
      executeResults: [
        { rowCount: 0 },
        {
          rows: [
            { book_id_a: 1, book_id_b: 2, reasons: ['exact_metadata', 'fuzzy_metadata'], title_similarity: 1 },
            { book_id_a: 1, book_id_b: 3, reasons: ['fuzzy_metadata'], title_similarity: 0.91 },
          ],
          rowCount: 2,
        },
        {
          rows: [
            { book_id: 2, series_id: 5, series_index: '1' },
            { book_id: 3, series_id: 5, series_index: '2' },
          ],
          rowCount: 2,
        },
      ],
    });
    const repo = new BookDuplicatesRepository(db as never);

    await expect(repo.finalizeGroups(9)).resolves.toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const queries = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => renderSql(query));
    expect(queries[0]!.sql).toBe('SET LOCAL statement_timeout = 600000');
    const components = queries.find((query) => query.sql.includes('INSERT INTO tmp_book_duplicate_components'));
    expect(components!.params).toEqual([
      [1, 2],
      [1, 1],
    ]);
    expect(queries.some((query) => query.sql.replace(/\s+/g, ' ').includes('DELETE FROM "book_duplicate_pairs" pair'))).toBe(true);
  });

  it('paginates only groups with at least two currently accessible members', async () => {
    const groups = [{ id: 5, memberCount: 2 }];
    const db = mockDb({ selectResults: [[], [{ count: 1 }], [{ kind: 'duplicate', count: 1 }], groups, [{ groupId: 5 }], []] });
    const repo = new BookDuplicatesRepository(db as never);
    const user = { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never;

    await expect(repo.findGroups(9, 1, 20, [2], user, 'isbn', 'reclaimable', 'desc')).resolves.toEqual({
      groups,
      total: 1,
      kindTotals: { duplicate: 1, other_format: 0, other_edition: 0 },
    });
    await expect(repo.findPairs([])).resolves.toEqual([]);
    await expect(repo.findPairs([5])).resolves.toEqual([{ groupId: 5 }]);
    await expect(repo.findCandidatePreviews([], [2], user)).resolves.toEqual([]);
    await expect(repo.findCandidatePreviews([5], [], user)).resolves.toEqual([]);
  });

  it('orders by reclaimable bytes, copies, confidence or title', async () => {
    const user = { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never;
    const orderings: Record<string, string> = {};
    for (const sortBy of ['reclaimable', 'copies', 'confidence', 'title'] as const) {
      const db = mockDb({ selectResults: [[], [{ count: 0 }], [], []] });
      const repo = new BookDuplicatesRepository(db as never);
      await repo.findGroups(9, 1, 20, [2], user, undefined, sortBy, 'desc');
      const builder = (db.select as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>;
      orderings[sortBy] = builder.orderBy.mock.calls[0]!.map((clause) => renderSql(clause).sql).join(' | ');
    }

    expect(orderings.reclaimable).toContain('member_bytes_total');
    expect(orderings.reclaimable).toContain('member_bytes_max');
    expect(orderings.copies).toContain('member_count');
    expect(orderings.confidence).toContain('confidence');
    expect(orderings.title).toContain('lower(coalesce(');
  });

  it('leaves out groups whose members are now editions of one work or whose pairs were all dismissed', async () => {
    const db = mockDb({ selectResults: [[], [{ count: 0 }], [], []] });
    const repo = new BookDuplicatesRepository(db as never);
    const user = { id: 7, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as never;

    await repo.findGroups(9, 1, 20, [2], user, undefined, 'reclaimable', 'desc', 'other_edition');

    const selects = (db.select as ReturnType<typeof vi.fn>).mock.results.map((result) => result.value as Record<string, ReturnType<typeof vi.fn>>);
    const having = renderSql(selects[0]!.having.mock.calls[0]![0]).sql;
    expect(having).toContain(`count(DISTINCT COALESCE('link:' || "book_links"."group_id", 'book:' || "books"."id")) >= 2`);
    const where = renderSql(selects[1]!.where.mock.calls[0]![0]);
    const flat = where.sql.replace(/\s+/g, ' ');
    expect(flat).toContain('FROM "book_duplicate_dismissals" dismissal');
    expect(flat).toContain('dismissal.user_id = $');
    expect(where.params).toContain(7);
  });

  it('deletes dismissed pairs for the scanning user before groups are formed', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    const repo = new BookDuplicatesRepository({ execute } as never);

    await expect(repo.deleteDismissedPairs(9, 7)).resolves.toBe(3);

    const query = renderSql(execute.mock.calls[0]![0]).sql.replace(/\s+/g, ' ');
    expect(query).toContain('DELETE FROM "book_duplicate_pairs"');
    expect(query).toContain('"book_duplicate_dismissals"');
    expect(query).toContain('dismissal.book_id_a = pair.book_id_a');
  });
});
