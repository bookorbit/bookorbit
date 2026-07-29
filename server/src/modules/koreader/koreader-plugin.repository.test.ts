import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlChunkText } from '../../common/test-utils/sql-chunk-text';
import { KoreaderPluginRepository } from './koreader-plugin.repository';

function makeQueryChain(result: unknown) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeInsertChain(result: unknown) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeDb() {
  return {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
  };
}

describe('KoreaderPluginRepository', () => {
  let db: ReturnType<typeof makeDb>;
  let repo: KoreaderPluginRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new KoreaderPluginRepository(db as never);
  });

  describe('getPluginTotals', () => {
    it('maps aggregate counts including linkable unmatched books', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            matched_books: '2',
            page_stat_events: '10',
            annotations: '4',
            trashed_annotations: '1',
            pending_deletes: '3',
            failed_positions: '5',
            unmatched_books: '6',
          },
        ],
      });

      await expect(repo.getPluginTotals(7)).resolves.toEqual({
        matchedBooks: 2,
        pageStatEvents: 10,
        annotations: 4,
        trashedAnnotations: 1,
        pendingDeletes: 3,
        failedPositions: 5,
        unmatchedBooks: 6,
      });

      const sqlText = sqlChunkText(db.execute.mock.calls[0]![0]).replace(/\s+/g, ' ');
      expect(sqlText).toContain('from koreader_unmatched_books');
      expect(sqlText).toContain("source in ('current_file', 'file')");
      expect(sqlText).toContain('metadata_ambiguous = false');
    });

    it('defaults missing aggregate rows to zeroes', async () => {
      db.execute.mockResolvedValue({ rows: [] });

      await expect(repo.getPluginTotals(7)).resolves.toEqual({
        matchedBooks: 0,
        pageStatEvents: 0,
        annotations: 0,
        trashedAnnotations: 0,
        pendingDeletes: 0,
        failedPositions: 0,
        unmatchedBooks: 0,
      });
    });
  });

  describe('getHashLinkVersion', () => {
    it('returns manual link count and newest update timestamp', async () => {
      db.select.mockReturnValue(makeQueryChain([{ count: '3', maxTs: '2026-06-02T10:00:00.000Z' }]));

      await expect(repo.getHashLinkVersion(7)).resolves.toEqual({
        count: 3,
        maxTs: new Date('2026-06-02T10:00:00.000Z'),
      });
    });

    it('returns an empty version when no link rows exist', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      await expect(repo.getHashLinkVersion(7)).resolves.toEqual({ count: 0, maxTs: null });
    });
  });

  describe('getRatings', () => {
    it('reads every requested book in one query and keys the result by book', async () => {
      const updatedAt = new Date('2026-06-01T10:00:00.000Z');
      db.select.mockReturnValue(
        makeQueryChain([
          { bookId: 20, rating: 4, updatedAt },
          { bookId: 21, rating: null, updatedAt },
        ]),
      );

      await expect(repo.getRatings(7, [20, 21, 20])).resolves.toEqual(
        new Map([
          [20, { rating: 4, updatedAt }],
          [21, { rating: null, updatedAt }],
        ]),
      );
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('issues no query for an empty book list', async () => {
      await expect(repo.getRatings(7, [])).resolves.toEqual(new Map());
      expect(db.select).not.toHaveBeenCalled();
    });

    it('splits oversized book lists into bounded queries', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      await repo.getRatings(
        7,
        Array.from({ length: 450 }, (_, index) => index + 1),
      );

      expect(db.select).toHaveBeenCalledTimes(3);
    });
  });

  describe('upsertRatings', () => {
    it('writes every entry in one statement and keeps per-row ratings', async () => {
      const insertChain = makeInsertChain(undefined);
      db.insert.mockReturnValue(insertChain);
      const updatedAt = new Date('2026-06-02T10:00:00.000Z');

      await repo.upsertRatings(
        7,
        [
          { bookId: 20, rating: 4 },
          { bookId: 21, rating: null },
        ],
        updatedAt,
      );

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith([
        { userId: 7, bookId: 20, rating: 4, updatedAt },
        { userId: 7, bookId: 21, rating: null, updatedAt },
      ]);
    });

    it('issues no statement for an empty entry list', async () => {
      await repo.upsertRatings(7, [], new Date());
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
