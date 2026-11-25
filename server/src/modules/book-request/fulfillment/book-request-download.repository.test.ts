import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
import { BookRequestDownloadRepository } from './book-request-download.repository';

/**
 * The list renders this for every row on the page, and a request accumulates attempts without
 * bound: automated retries are capped, but manual grabs and recorded refusals are not. What has to
 * hold is that the database returns one attempt per request, rather than every attempt for the
 * repository to throw all but one of them away.
 */
describe('BookRequestDownloadRepository.findLatestForRequests', () => {
  async function compiledQuery(): Promise<string> {
    const { db, queries } = createCapturingDb();
    await new BookRequestDownloadRepository(db as never).findLatestForRequests([7, 9]);
    return queries.at(-1)?.sql ?? '';
  }

  it('narrows to one attempt per request in the database', async () => {
    const { db, queries } = createCapturingDb();

    await new BookRequestDownloadRepository(db as never).findLatestForRequests([7, 9]);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('distinct on ("book_request_downloads"."request_id")');
    expect(queries[0].params).toEqual([7, 9]);
  });

  /** Highest id wins, because two attempts inserted in one transaction share a `created_at`. */
  it('picks the newest attempt by id', async () => {
    expect(await compiledQuery()).toContain('order by "book_request_downloads"."request_id", "book_request_downloads"."id" desc');
  });

  /** The join has to hang off the narrowed set, or the bound is decorative. */
  it('joins the client and indexer names onto the narrowed set', async () => {
    const sql = await compiledQuery();

    expect(sql).toContain('inner join');
    expect(sql).toContain('"newest_attempt"');
    expect(sql.indexOf('left join')).toBeGreaterThan(sql.indexOf('inner join'));
  });

  it('asks nothing at all for an empty page', async () => {
    const { db, queries } = createCapturingDb();

    await expect(new BookRequestDownloadRepository(db as never).findLatestForRequests([])).resolves.toEqual(new Map());
    expect(queries).toHaveLength(0);
  });
});

/**
 * Read before a person files or discards a request's held file in the Book Dock. It has to find
 * only a request still waiting on that exact file, or the dock would settle a request that has
 * already moved on.
 */
describe('BookRequestDownloadRepository.findHeldOverDockFiles', () => {
  async function compiled(): Promise<{ sql: string; params: unknown[] }> {
    const { db, queries } = createCapturingDb();
    await new BookRequestDownloadRepository(db as never).findHeldOverDockFiles([100, 101]);
    expect(queries).toHaveLength(1);
    return queries[0];
  }

  it('reads the attempts linked to those files, with both sides still in review', async () => {
    const { sql, params } = await compiled();

    expect(sql).toContain('"book_request_downloads"."book_dock_file_id" in ($1, $2)');
    expect(sql).toContain('"book_request_downloads"."status" = $3');
    expect(sql).toContain('"book_requests"."status" = $4');
    expect(params).toEqual([100, 101, 'needs_review', 'needs_review']);
  });

  it("takes only the request's newest attempt, and only while the request points at the same file", async () => {
    const { sql } = await compiled();

    expect(sql).toContain(
      'not exists (select 1 from "book_request_downloads" "later_attempt" where "later_attempt"."request_id" = "book_request_downloads"."request_id" and "later_attempt"."id" > "book_request_downloads"."id")',
    );
    expect(sql).toContain(
      '("book_requests"."book_dock_file_id" is null or "book_requests"."book_dock_file_id" = "book_request_downloads"."book_dock_file_id")',
    );
  });

  it('asks nothing at all for no files', async () => {
    const { db, queries } = createCapturingDb();

    await expect(new BookRequestDownloadRepository(db as never).findHeldOverDockFiles([])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

describe('BookRequestDownloadRepository.findTriedReleaseKeys', () => {
  function repositoryReturning(rows: Array<{ indexerId: number | null; releaseGuid: string | null }>) {
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) };
    return new BookRequestDownloadRepository(db as never);
  }

  /**
   * Torznab guids are digested now, and an attempt made before that stored the raw link. Without
   * the digested key alongside it, the next automated retry would pick the release that failed.
   */
  it('also matches a raw URL guid stored before guids were digested', async () => {
    const keys = await repositoryReturning([{ indexerId: 3, releaseGuid: 'https://tracker.example.com/details/1' }]).findTriedReleaseKeys(9);

    expect(keys.has('3:https://tracker.example.com/details/1')).toBe(true);
    expect(keys.size).toBe(2);
    expect([...keys].some((key) => /^3:[a-f0-9]{64}$/.test(key))).toBe(true);
  });

  it('adds nothing for an opaque guid or a hand-pasted magnet', async () => {
    const keys = await repositoryReturning([
      { indexerId: 3, releaseGuid: '12345' },
      { indexerId: null, releaseGuid: null },
    ]).findTriedReleaseKeys(9);

    expect([...keys]).toEqual(['3:12345']);
  });
});
