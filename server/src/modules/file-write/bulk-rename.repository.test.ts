import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../db/schema';
import { BulkRenameRepository } from './bulk-rename.repository';

describe('BulkRenameRepository', () => {
  function queryChain(rows: unknown) {
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
  }

  function subqueryChain() {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };
  }

  describe('findAllBooksForLibrary', () => {
    it('maps book rows and groups authors by book', async () => {
      const bookRows = [
        {
          bookId: 1,
          absolutePath: '/lib/old/a.epub',
          relPath: 'old/a.epub',
          format: 'epub',
          libraryFolderPath: '/lib',
          organizationMode: 'book_per_file',
          fileNamingPattern: '{title}',
          bookFolderPath: '/lib/old/a.epub',
          title: 'A',
          subtitle: null,
          publisher: null,
          language: 'en',
          isbn13: null,
          publishedYear: 2001,
          seriesName: null,
          seriesIndex: null,
        },
        {
          bookId: 2,
          absolutePath: '/lib/old/b.epub',
          relPath: 'old/b.epub',
          format: 'epub',
          libraryFolderPath: '/lib',
          organizationMode: 'book_per_file',
          fileNamingPattern: '{title}',
          bookFolderPath: '/lib/old/b.epub',
          title: 'B',
          subtitle: null,
          publisher: null,
          language: null,
          isbn13: null,
          publishedYear: null,
          seriesName: null,
          seriesIndex: null,
        },
      ];
      const authorRows = [
        { bookId: 1, name: 'Author One' },
        { bookId: 1, name: 'Author Two' },
        { bookId: 2, name: 'Author Three' },
      ];
      const narratorRows = [
        { bookId: 1, name: 'Narrator One' },
        { bookId: 2, name: 'Narrator Two' },
        { bookId: 2, name: 'Narrator Three' },
      ];

      const db = {
        select: vi
          .fn()
          .mockReturnValueOnce(queryChain(bookRows))
          .mockReturnValueOnce(subqueryChain())
          .mockReturnValueOnce(queryChain(authorRows))
          .mockReturnValueOnce(queryChain(narratorRows))
          .mockReturnValue(subqueryChain()),
      };

      const repo = new BulkRenameRepository(db as never);
      const result = await repo.findAllBooksForLibrary(7);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        bookId: 1,
        title: 'A',
        absolutePath: '/lib/old/a.epub',
        authors: ['Author One', 'Author Two'],
        narrators: ['Narrator One'],
        metadata: { language: 'en', publishedYear: 2001 },
      });
      expect(result[1]).toMatchObject({ bookId: 2, authors: ['Author Three'], narrators: ['Narrator Two', 'Narrator Three'] });
    });

    it('returns books with empty author and narrator lists when none are linked', async () => {
      const bookRows = [
        {
          bookId: 1,
          absolutePath: '/lib/old/a.epub',
          relPath: 'old/a.epub',
          format: 'epub',
          libraryFolderPath: '/lib',
          organizationMode: 'book_per_file',
          fileNamingPattern: '{title}',
          bookFolderPath: '/lib/old/a.epub',
          title: 'A',
          subtitle: null,
          publisher: null,
          language: null,
          isbn13: null,
          publishedYear: null,
          seriesName: null,
          seriesIndex: null,
        },
      ];

      const db = {
        select: vi
          .fn()
          .mockReturnValueOnce(queryChain(bookRows))
          .mockReturnValueOnce(subqueryChain())
          .mockReturnValueOnce(queryChain([]))
          .mockReturnValueOnce(queryChain([]))
          .mockReturnValue(subqueryChain()),
      };

      const repo = new BulkRenameRepository(db as never);
      const result = await repo.findAllBooksForLibrary(7);

      expect(result).toHaveLength(1);
      expect(result[0].authors).toEqual([]);
      expect(result[0].narrators).toEqual([]);
    });

    it('returns an empty array and skips the contributor queries when the library has no books', async () => {
      const db = { select: vi.fn().mockReturnValueOnce(queryChain([])) };

      const repo = new BulkRenameRepository(db as never);
      const result = await repo.findAllBooksForLibrary(7);

      expect(result).toEqual([]);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('fetches contributors via a library subquery, never a per-book parameter list (issue #361)', async () => {
      const calls: Array<{ text: string; params: unknown[] }> = [];
      const fakeClient = {
        query: vi.fn().mockImplementation((cfg: { text: string }, params: unknown[]) => {
          calls.push({ text: cfg.text, params });
          // The first (books) query must return at least one row so the author query runs.
          return Promise.resolve({ rows: calls.length === 1 ? [new Array(16).fill(null)] : [] });
        }),
      };

      const db = drizzle({ client: fakeClient as never, schema });
      const repo = new BulkRenameRepository(db as never);

      await repo.findAllBooksForLibrary(42);

      expect(calls).toHaveLength(3);

      // The ONLY bind parameter is the libraryId - not one entry per book - so neither statement
      // can exceed PostgreSQL's 65535-parameter wire-protocol limit, regardless of library size.
      for (const contributorQuery of calls.slice(1)) {
        expect(contributorQuery.params).toEqual([42]);

        const sqlText = contributorQuery.text.toLowerCase();
        expect(sqlText).toContain('in (select');
        expect(sqlText).toContain('"library_id"');
      }
    });
  });

  describe('findLibrarySettings', () => {
    function settingsChain(rows: unknown) {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(rows),
      };
    }

    it('returns the settings row when the library exists', async () => {
      const row = { fileRenameEnabled: true, fileNamingPattern: '{title}', organizationMode: 'book_per_file', watch: false };
      const db = { select: vi.fn().mockReturnValue(settingsChain([row])) };

      const repo = new BulkRenameRepository(db as never);

      await expect(repo.findLibrarySettings(1)).resolves.toEqual(row);
    });

    it('returns null when the library is missing', async () => {
      const db = { select: vi.fn().mockReturnValue(settingsChain([])) };

      const repo = new BulkRenameRepository(db as never);

      await expect(repo.findLibrarySettings(999)).resolves.toBeNull();
    });
  });
});
