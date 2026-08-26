import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
import { IndexerRepository } from './indexer.repository';

describe('IndexerRepository', () => {
  it('selects only assigned colors when choosing a default for a new indexer', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.findAssignedColors();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/^select "color" from "request_indexers"/);
  });

  it('deletes every indexer with the requested adapter type in one query', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.deleteByAdapterType('demo-tracker');

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/delete from "request_indexers" where "request_indexers"\."adapter_type" = \$1/);
    expect(queries[0].params).toEqual(['demo-tracker']);
  });

  it('replaces a rotated credential only while the whole config snapshot is current', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);
    const updatedAt = new Date('2026-08-25T12:00:00Z');

    await repository.updateCredentialIfCurrent(4, 'old-ciphertext', updatedAt, 'new-ciphertext');

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /update "request_indexers" set "credentials_enc" = \$1, "updated_at" = \$2 where \("request_indexers"\."id" = \$3 and "request_indexers"\."updated_at" = \$4 and "request_indexers"\."credentials_enc" = \$5\)/,
    );
    expect(queries[0].params[0]).toBe('new-ciphertext');
    expect(queries[0].params.slice(2)).toEqual([4, updatedAt.toISOString(), 'old-ciphertext']);
  });

  /**
   * One statement for the batch. This runs on the back of every merged search, and a round trip
   * per enabled indexer on an instance with a dozen of them is a cost the picker would pay for a
   * badge nobody is looking at yet.
   */
  it('records every configured source outcome in one statement', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.recordSearchOutcomes([
      { indexerId: 1, ok: true, error: null },
      { indexerId: 2, ok: false, error: 'The tracker answered 429' },
    ]);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/update "request_indexers" set "last_search_at" = \$1, "last_search_ok" = case when/);
    expect(queries[0].sql).toMatch(/"request_indexers"\."id" in \(\$\d+, \$\d+\)/);
    expect(queries[0].sql).toMatch(/"request_indexers"\."last_search_at" is null or "request_indexers"\."last_search_at" < \$\d+/);
    expect(queries[0].params).toContain('The tracker answered 429');
  });

  /**
   * The streak is computed in SQL rather than read and written back, so two searches finishing at
   * once cannot both write the same number. A success resets it outright.
   */
  it('increments the failure streak in place and resets it on a success', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.recordSearchOutcomes([
      { indexerId: 1, ok: false, error: 'timed out' },
      { indexerId: 2, ok: true, error: null },
    ]);

    expect(queries[0].sql).toMatch(/"search_failure_streak" = case when .* then "request_indexers"\."search_failure_streak" \+ 1/);
    expect(queries[0].sql).toMatch(/then 0 end/);
  });

  /** Nothing was searched, so there is nothing to say about any source. */
  it('writes nothing when a search reported no outcomes at all', async () => {
    const { db, queries } = createCapturingDb();

    await new IndexerRepository(db).recordSearchOutcomes([]);

    expect(queries).toHaveLength(0);
  });
});
