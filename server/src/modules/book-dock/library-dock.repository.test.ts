import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import { BookDockKeptFilesRepository } from './book-dock-kept-files.repository';
import { BookDockRepository } from './book-dock.repository';
import { LibraryDockRepository } from './library-dock.repository';

interface CapturedQuery {
  text: string;
  values: unknown[];
}

/**
 * A node-postgres stand-in that records the SQL drizzle actually renders and answers with canned
 * rows, so these tests read real clauses instead of a mocked query builder.
 */
function capturingDb(rows: unknown[][] = []) {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (query: { text: string; values?: unknown[] } | string, values?: unknown[]) => {
      const text = typeof query === 'string' ? query : query.text;
      queries.push({ text, values: (typeof query === 'string' ? undefined : query.values) ?? values ?? [] });
      return Promise.resolve({ rows, rowCount: rows.length, fields: [] });
    },
  };
  return { db: drizzle({ client: client as never, schema }), queries };
}

describe('LibraryDockRepository', () => {
  it('finds a folder name ignoring case, with the name normalised the way it was stored', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).findByFolderName('Café FICTION');

    expect(queries[0].text).toContain('lower("library_docks"."folder_name") = $1');
    expect(queries[0].values[0]).toBe('café fiction');
  });

  it('lists only enabled docks, with their library names, in library name order', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).listEnabled();

    const sql = queries[0].text;
    expect(sql).toContain('inner join "libraries" on "libraries"."id" = "library_docks"."library_id"');
    expect(sql).toContain('"library_docks"."enabled" = $1');
    expect(queries[0].values[0]).toBe(true);
    expect(sql).toMatch(/order by "libraries"\."name" asc, "libraries"\."id" asc/);
  });

  it('lists every dock, enabled or not', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).listAll();

    expect(queries[0].text).not.toContain('"enabled" =');
  });

  it('lists the turned-on docks of the given libraries for uploads, with what each library takes', async () => {
    const { db, queries } = capturingDb();
    const repo = new LibraryDockRepository(db);
    await repo.listUploadTargets([4, 9]);
    await repo.listUploadTargets([]);

    expect(queries).toHaveLength(1);
    const sql = queries[0].text;
    expect(sql).toContain('"libraries"."allowed_formats"');
    expect(sql).toContain('where ("library_docks"."enabled" = $1 and "library_docks"."library_id" in ($2, $3))');
    expect(queries[0].values).toEqual([true, 4, 9]);
    expect(sql).toMatch(/order by "libraries"\."name" asc, "libraries"\."id" asc/);
  });

  it('updates a dock by id and returns the stored row', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).update(4, { enabled: false });

    expect(queries[0].text).toMatch(/^update "library_docks" set "enabled" = \$1, "updated_at" = \$2 where "library_docks"\."id" = \$3 returning/);
  });
});

describe('BookDockRepository.countsByDock', () => {
  it('counts every dock as the switcher shows it in one grouped query, request downloads under their library', async () => {
    const { db, queries } = capturingDb([
      [null, '4', '1', '2', '0', '1'],
      [7, '6', '2', '4', '0', '0'],
    ]);
    const counts = await new BookDockRepository(db).countsByDock();

    expect(queries).toHaveLength(1);
    const sql = queries[0].text;
    expect(sql).toContain(
      'left join "library_docks" on (("book_dock_files"."dock_id" is null and "book_dock_files"."auto_finalize_suppressed" = $1) and "library_docks"."library_id" = "book_dock_files"."target_library_id")',
    );
    expect(sql).toContain('group by coalesce("book_dock_files"."dock_id", "library_docks"."id")');
    expect(sql).toContain(`count(*) filter (where "book_dock_files"."status" in ('pending', 'extracting', 'fetching'))`);
    expect(sql).toContain(`count(*) filter (where "book_dock_files"."status" = 'ready' and "book_dock_files"."hold_reason" is not null)`);
    expect(sql).toContain(`count(*) filter (where "book_dock_files"."status" = 'ready' and "book_dock_files"."hold_reason" is null)`);
    expect(sql).not.toContain('where "book_dock_files"."uploaded_by"');
    expect(counts).toEqual([
      { dockId: null, total: 4, working: 1, onHold: 2, ready: 0, error: 1 },
      { dockId: 7, total: 6, working: 2, onHold: 4, ready: 0, error: 0 },
    ]);
  });

  it("counts only the caller's own uploads for someone who cannot manage the dock", async () => {
    const { db, queries } = capturingDb();
    await new BookDockRepository(db).countsByDock(12, false);

    expect(queries[0].text).toContain('where "book_dock_files"."uploaded_by" = $2');
    expect(queries[0].values).toEqual([true, 12]);
  });
});

describe('BookDockRepository hold filter', () => {
  it('splits held files per dock and reason, grouped the way the dock counts are', async () => {
    const { db, queries } = capturingDb([
      [null, 'no_destination', '3'],
      [7, 'duplicate', '2'],
    ]);
    const counts = await new BookDockRepository(db).holdCountsByDock(12, false);

    const sql = queries[0].text;
    expect(sql).toContain('group by coalesce("book_dock_files"."dock_id", "library_docks"."id"), "book_dock_files"."hold_reason"');
    expect(sql).toContain(
      'where (("book_dock_files"."status" = $2 and "book_dock_files"."hold_reason" is not null) and "book_dock_files"."uploaded_by" = $3)',
    );
    expect(queries[0].values).toEqual([true, 'ready', 12]);
    expect(counts).toEqual([
      { dockId: null, reason: 'no_destination', count: 3 },
      { dockId: 7, reason: 'duplicate', count: 2 },
    ]);
  });

  it.each([
    ['held', '("book_dock_files"."status" = $1 and "book_dock_files"."hold_reason" is not null)', ['ready']],
    ['clear', '("book_dock_files"."status" = $1 and "book_dock_files"."hold_reason" is null)', ['ready']],
    ['duplicate', '("book_dock_files"."status" = $1 and "book_dock_files"."hold_reason" = $2)', ['ready', 'duplicate']],
  ] as const)('reads %s as ready files with that hold, on the list and on select-all', async (hold, condition, values) => {
    const { db, queries } = capturingDb([['0']]);
    const repo = new BookDockRepository(db);
    await repo.findAll({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 0, canManageAll: true, filter: { hold } });
    await repo.findAllIds(undefined, undefined, undefined, 0, true, undefined, undefined, { hold });

    for (const query of [queries[0], queries[2]]) {
      expect(query.text.slice(query.text.indexOf(' where '))).toContain(condition);
      expect(query.values.slice(0, values.length)).toEqual(values);
    }
  });
});

describe('LibraryDockRepository folder moves', () => {
  const updatesTo = (queries: CapturedQuery[], table: string) => queries.filter((q) => q.text.startsWith(`update "${table}"`));

  it('renames the folder and repoints every path under it in one transaction', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).renameFolder(4, 'Novels', '/dock/_libraries/Fiction', '/dock/_libraries/Novels');

    expect(queries[0].text).toBe('begin');
    expect(queries.at(-1)?.text).toBe('commit');
    expect(updatesTo(queries, 'library_docks')[0].values).toEqual(expect.arrayContaining(['Novels', 4]));
    const fileUpdates = updatesTo(queries, 'book_dock_files');
    expect(fileUpdates.map((q) => q.text.match(/set "(\w+)"/)?.[1])).toEqual(['absolute_path', 'unit_directory']);
    for (const q of [...fileUpdates, ...updatesTo(queries, 'book_dock_unit_files'), ...updatesTo(queries, 'book_dock_kept_files')]) {
      expect(q.text).toContain('|| substr(');
      expect(q.text).toContain('length($2::text) + 1)');
      expect(q.text).toContain('starts_with(');
      expect(q.values).toEqual(expect.arrayContaining(['/dock/_libraries/Novels', '/dock/_libraries/Fiction', '/dock/_libraries/Fiction/']));
    }
  });

  it('never matches a sibling folder that only shares the start of the name', async () => {
    const { db, queries } = capturingDb();
    await new LibraryDockRepository(db).movePaths('/dock/_libraries/Old/Dune', '/dock/Dune');

    const update = updatesTo(queries, 'book_dock_files')[0];
    expect(update.text).toMatch(/where \("book_dock_files"\."absolute_path" = \$\d+ or starts_with\("book_dock_files"\."absolute_path", \$\d+\)\)/);
    expect(update.values).toContain('/dock/_libraries/Old/Dune/');
    expect(update.values).not.toContain('/dock/_libraries/Old/Dune%');
  });
});

describe('BookDockRepository library lifecycle', () => {
  it('counts only files still being read at or under a folder', async () => {
    const { db, queries } = capturingDb([['2']]);
    await expect(new BookDockRepository(db).countWorkingUnder('/dock/_libraries/Fiction')).resolves.toBe(2);

    expect(queries[0].text).toContain('"book_dock_files"."status" in ($1, $2, $3)');
    expect(queries[0].values.slice(0, 3)).toEqual(['pending', 'extracting', 'fetching']);
    expect(queries[0].values).toContain('/dock/_libraries/Fiction/');
  });

  it('marks files of a deleted library in batches, touching only rows the delete cleared', async () => {
    const { db, queries } = capturingDb();
    const ids = Array.from({ length: 2500 }, (_, index) => index + 1);
    await new BookDockRepository(db).markFromDeletedLibrary(ids, 'Fiction');

    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.text).toContain('set "former_library_name" = $1, "hold_reason" = $2, "hold_detail" = $3');
      expect(q.text).toContain('"book_dock_files"."target_library_id" is null');
      expect(q.values[0]).toBe('Fiction');
    }
  });

  it('holds files whose folder was removed, only where the removal cleared the folder', async () => {
    const { db, queries } = capturingDb();
    await new BookDockRepository(db).holdForRemovedFolder([5, 6], 14, 'Fiction');

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('"book_dock_files"."target_library_id" = $');
    expect(queries[0].text).toContain('"book_dock_files"."target_folder_id" is null');
    expect(queries[0].values).toEqual(expect.arrayContaining(['no_folder', JSON.stringify({ libraryId: 14, libraryName: 'Fiction' }), 14]));
  });

  it('asks nothing for an empty folder list', async () => {
    const { db, queries } = capturingDb();
    await expect(new BookDockRepository(db).findIdsByTargetFolders([])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

describe('BookDockRepository holds and duplicates', () => {
  it('looks up edition ids only on columns it was given values for, each through its partial index', async () => {
    const { db, queries } = capturingDb();
    await new BookDockRepository(db).findJoinCandidatesByEditionId([5, 6], {
      amazonIds: ['B00B7NPRY8'],
      audibleIds: [],
      googleBooksIds: ['abc'],
      goodreadsIds: [],
    });

    expect(queries).toHaveLength(1);
    const where = queries[0].text.slice(queries[0].text.lastIndexOf(' where '));
    expect(where).toContain('("book_metadata"."amazon_id" is not null and "book_metadata"."amazon_id" in ($1))');
    expect(where).toContain('("book_metadata"."google_books_id" is not null and "book_metadata"."google_books_id" in ($2))');
    expect(where).not.toContain('audible_id');
    expect(where).not.toContain('goodreads_id');
    expect(queries[0].values).toEqual(expect.arrayContaining(['B00B7NPRY8', 'abc', 5, 6]));
  });

  it('asks nothing for edition ids when there are none', async () => {
    const { db, queries } = capturingDb();
    await expect(
      new BookDockRepository(db).findJoinCandidatesByEditionId([5], { amazonIds: [], audibleIds: [], googleBooksIds: [], goodreadsIds: [] }),
    ).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("selects one dock's files, or Unsorted's", async () => {
    const { db, queries } = capturingDb();
    const repo = new BookDockRepository(db);
    await repo.findSelectionBatch({ limit: 100, status: 'ready', userId: 0, canManageAll: true, dockId: 11 });
    await repo.findSelectionBatch({ limit: 100, status: 'ready', userId: 0, canManageAll: true, dockId: null });
    await repo.findSelectionBatch({ limit: 100, status: 'ready', userId: 0, canManageAll: true });

    expect(queries[0].text).toContain('"book_dock_files"."dock_id" = $');
    expect(queries[0].values).toContain(11);
    expect(queries[1].text).toContain('"book_dock_files"."dock_id" is null');
    expect(queries[2].text.slice(queries[2].text.indexOf(' where '))).not.toContain('dock_id');
  });

  it('shows Unsorted without request downloads headed for a library that has a dock (D6)', async () => {
    const { db, queries } = capturingDb();
    await new BookDockRepository(db).findSelectionBatch({ limit: 100, userId: 0, canManageAll: true, filter: { dock: 'unsorted' } });

    const where = queries[0].text.slice(queries[0].text.indexOf(' where '));
    expect(where).toContain(
      '("book_dock_files"."dock_id" is null and not (("book_dock_files"."dock_id" is null and "book_dock_files"."auto_finalize_suppressed" = $1) and exists (select 1 from "library_docks" where "library_docks"."library_id" = "book_dock_files"."target_library_id")))',
    );
    expect(queries[0].values[0]).toBe(true);
  });

  it("shows a dock's own arrivals and the request downloads headed for its library", async () => {
    const { db, queries } = capturingDb([['0']]);
    const repo = new BookDockRepository(db);
    await repo.findAll({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 3, canManageAll: false, filter: { dock: 7 } });
    await repo.findAllIds(undefined, undefined, undefined, 3, false, undefined, undefined, { dock: 7 });

    for (const query of [queries[0], queries[2]]) {
      const where = query.text.slice(query.text.indexOf(' where '));
      expect(where).toContain(
        '("book_dock_files"."dock_id" = $1 or (("book_dock_files"."dock_id" is null and "book_dock_files"."auto_finalize_suppressed" = $2) and "book_dock_files"."target_library_id" = (select "library_docks"."library_id" from "library_docks" where "library_docks"."id" = $3)))',
      );
      expect(where).toContain('"book_dock_files"."uploaded_by" = $4');
      expect(query.values.slice(0, 4)).toEqual([7, true, 7, 3]);
    }
  });

  it("gives a dock's files waiting on a folder the new one, and only those", async () => {
    const { db, queries } = capturingDb([[1], [2]]);
    await expect(new BookDockRepository(db).fillMissingFolder(11, 5, 9)).resolves.toBe(2);

    expect(queries[0].text).toContain('set "target_folder_id" = $1, "hold_reason" = $2');
    expect(queries[0].text).toContain('"book_dock_files"."dock_id" = $');
    expect(queries[0].text).toContain('"book_dock_files"."target_library_id" = $');
    expect(queries[0].text).toContain('"book_dock_files"."target_folder_id" is null');
    expect(queries[0].values.slice(0, 2)).toEqual([9, null]);
    expect(queries[0].values).toEqual(expect.arrayContaining([11, 5]));
  });

  it('drops the reason and any "Keep both" when files get a new destination', async () => {
    const { db, queries } = capturingDb();
    await new BookDockRepository(db).setTargetsByIds([1, 2], 5, 9);

    expect(queries[0].text).toContain('"hold_reason" = $3, "hold_detail" = $4');
    expect(queries[0].values.slice(0, 4)).toEqual([5, 9, null, null]);
  });
});

describe('BookDockKeptFilesRepository', () => {
  it('counts kept files per dock in one grouped query, leaving out discarded ones', async () => {
    const { db, queries } = capturingDb([
      [null, '3'],
      [5, '212'],
    ]);
    const counts = await new BookDockKeptFilesRepository(db).countByDock();

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('"book_dock_kept_files"."ignored" = $1');
    expect(queries[0].values[0]).toBe(false);
    expect(queries[0].text).toContain('group by "book_dock_kept_files"."dock_id"');
    expect(counts).toEqual(
      new Map([
        [null, 3],
        [5, 212],
      ]),
    );
  });

  it('replaces what it knew about a path seen again', async () => {
    const { db, queries } = capturingDb();
    await new BookDockKeptFilesRepository(db).upsert([
      { absolutePath: '/dock/a.epub', fileSize: 10, mtimeMs: 1700000000000, dockId: 11, bookId: 42, ignored: false },
    ]);

    expect(queries[0].text).toContain('insert into "book_dock_kept_files"');
    expect(queries[0].text).toContain(
      'on conflict ("absolute_path") do update set "file_size" = excluded.file_size, "mtime_ms" = excluded.mtime_ms, "dock_id" = excluded.dock_id, "book_id" = excluded.book_id, "ignored" = excluded.ignored',
    );
  });

  it('writes and deletes in bounded batches, and asks nothing for none', async () => {
    const { db, queries } = capturingDb();
    const repo = new BookDockKeptFilesRepository(db);
    await repo.upsert([]);
    await repo.deleteByIds([]);
    expect(queries).toHaveLength(0);

    await repo.deleteByIds(Array.from({ length: 1001 }, (_, index) => index + 1));
    expect(queries).toHaveLength(3);
  });

  it('forgets a deleted path and everything under it, never a sibling that only shares the start of its name', async () => {
    const { db, queries } = capturingDb();
    await new BookDockKeptFilesRepository(db).deleteAtOrUnder('/dock/_libraries/Fiction/Dune');

    expect(queries[0].text).toContain('"book_dock_kept_files"."absolute_path" = $1 or starts_with("book_dock_kept_files"."absolute_path", $2)');
    expect(queries[0].values).toEqual(['/dock/_libraries/Fiction/Dune', '/dock/_libraries/Fiction/Dune/']);
  });

  it('pages through entries by id', async () => {
    const { db, queries } = capturingDb();
    const repo = new BookDockKeptFilesRepository(db);
    await repo.findPage(undefined, 500);
    await repo.findPage(500, 500);

    expect(queries[0].text).not.toContain(' where ');
    expect(queries[1].text).toContain('"book_dock_kept_files"."id" > $1');
    expect(queries[1].text).toContain('order by "book_dock_kept_files"."id" asc limit $2');
  });
});
