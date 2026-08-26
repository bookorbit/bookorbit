import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
import { DownloadClientRepository } from './download-client.repository';

/**
 * The compiled SQL rather than a hand-mocked `db`, because everything worth asserting here is what
 * the dialect adds: the ordering that decides which client a grab lands on, the transaction that
 * keeps a half-applied mapping edit from existing, and the `length()` ordering that lets the caller
 * take the first prefix match instead of scanning them all.
 */
describe('DownloadClientRepository', () => {
  it('orders every enabled client by priority, then by id so the pick is stable', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).findAllEnabled();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /where "download_clients"\."enabled" = \$1 order by "download_clients"\."priority" asc, "download_clients"\."id" asc/,
    );
  });

  it('narrows the grab default to clients that can carry out that kind of grab, and takes one', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).findPreferredEnabled(['qbittorrent', 'transmission']);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/"download_clients"\."adapter_type" in \(\$2, \$3\)/);
    expect(queries[0].sql).toMatch(/order by "download_clients"\."priority" asc, "download_clients"\."id" asc limit \$4/);
    expect(queries[0].params.slice(1)).toEqual(['qbittorrent', 'transmission', 1]);
  });

  /**
   * An empty list is not "any client will do". Asking Postgres for `in ()` is either a syntax error
   * or, worse, a filter that matches everything, and either way the answer to "which client can
   * deliver this" is none of them.
   */
  it('asks nothing at all when no adapter type could deliver the grab', async () => {
    const { db, queries } = createCapturingDb();

    await expect(new DownloadClientRepository(db).findPreferredEnabled([])).resolves.toBeUndefined();

    expect(queries).toHaveLength(0);
  });

  /**
   * The `updated_at` column is not in the patch this method writes; the dialect adds it from the
   * table's `$onUpdateFn`. Worth pinning, because a failing connection test therefore bumps the
   * row's modification time, and the credential-rotation guard elsewhere compares against it.
   */
  it('records a test result against the row it tested, and the dialect bumps updated_at with it', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).recordTestResult(7, false, 'Connection refused');

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /update "download_clients" set "last_tested_at" = \$1, "last_test_ok" = \$2, "last_error_message" = \$3, "updated_at" = \$4 where "download_clients"\."id" = \$5/,
    );
    expect(queries[0].params[1]).toBe(false);
    expect(queries[0].params[2]).toBe('Connection refused');
    expect(queries[0].params[4]).toBe(7);
  });

  /**
   * Wholesale replacement inside one transaction. Half an edit would leave a client translating
   * some paths with the old set and some with the new, which is an import reading out of a
   * directory nobody authorised.
   */
  it('replaces path mappings in one transaction', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).replacePathMappings(3, [
      { remotePath: '/downloads', localPath: '/mnt/downloads' },
      { remotePath: '/downloads/books', localPath: '/mnt/downloads/books' },
    ]);

    expect(queries.map((query) => query.sql)).toEqual([
      'begin',
      expect.stringMatching(/delete from "download_client_path_mappings" where "download_client_path_mappings"\."download_client_id" = \$1/),
      expect.stringMatching(/insert into "download_client_path_mappings"/),
      'commit',
    ]);
  });

  /** Clearing every mapping is a real edit: the delete still runs, and there is nothing to insert. */
  it('deletes without inserting when the client is left with no mappings', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).replacePathMappings(3, []);

    expect(queries.map((query) => query.sql)).toEqual(['begin', expect.stringMatching(/delete from "download_client_path_mappings"/), 'commit']);
  });

  /**
   * Longest prefix first, so the caller can take the first match. Without it `/downloads` would
   * shadow `/downloads/books` and translate a path into the wrong local root.
   */
  it('returns path mappings longest prefix first', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).findPathMappings(3);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/order by length\("download_client_path_mappings"\."remote_path"\) desc/);
  });

  it('reads the mappings for a page of clients in one query rather than one per client', async () => {
    const { db, queries } = createCapturingDb();

    await new DownloadClientRepository(db).findAll();

    // The client list, then the mappings for whatever came back. A stub answers with no rows, so
    // the second query is skipped entirely rather than issued against an empty id list.
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/^select .* from "download_clients" order by/);
  });
});
