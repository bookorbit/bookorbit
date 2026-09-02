import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { BookRequestRepository } from './book-request.repository';

function makeDb() {
  const chainable = {
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };

  chainable.update.mockReturnValue(chainable);
  chainable.set.mockReturnValue(chainable);
  chainable.where.mockReturnValue(chainable);
  chainable.returning.mockResolvedValue([{ id: 7 }]);

  return chainable;
}

/** What `set()` was actually handed, which is the only thing these cases are about. */
function written(db: ReturnType<typeof makeDb>): Record<string, unknown> {
  return db.set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('BookRequestRepository.update', () => {
  it('clears the classified failure fields when a new reason arrives without one', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await repo.update(7, { status: 'failed', statusReason: 'the tracker answered 406' });

    expect(written(db)).toEqual({ status: 'failed', statusReason: 'the tracker answered 406', failureCode: null, failureMeta: null });
  });

  /** A grab clearing the reason must clear the code with it, or the UI translates a stale failure. */
  it('clears them when the reason itself is cleared', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await repo.update(7, { status: 'grabbed', statusReason: null });

    expect(written(db)).toEqual({ status: 'grabbed', statusReason: null, failureCode: null, failureMeta: null });
  });

  it('keeps a code the caller supplied alongside its reason', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await repo.update(7, {
      status: 'approved',
      statusReason: 'nothing cleared the floor',
      failureCode: 'BELOW_SCORE_FLOOR',
      failureMeta: { floor: 80 },
    });

    expect(written(db)).toMatchObject({ failureCode: 'BELOW_SCORE_FLOOR', failureMeta: { floor: 80 } });
  });

  /** An update that says nothing about failure must not quietly wipe the reason already on the row. */
  it('leaves the failure fields alone when the update is about something else', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await repo.update(7, { status: 'downloading' });

    expect(written(db)).toEqual({ status: 'downloading' });
  });
});

describe('BookRequestRepository.updateIf', () => {
  /** The same invariant `update` enforces: nothing about a conditional write changes it. */
  it('clears the classified failure fields when a new reason arrives without one', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await repo.updateIf(7, ['downloading'], { status: 'failed', statusReason: 'the tracker answered 406' });

    expect(written(db)).toEqual({ status: 'failed', statusReason: 'the tracker answered 406', failureCode: null, failureMeta: null });
  });

  it('resolves to the row it wrote when the status still held', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await expect(repo.updateIf(7, ['pending'], { status: 'approved' })).resolves.toEqual({ id: 7 });
  });

  /** No row matched the status filter, which is the caller's cue to refuse rather than report success. */
  it('resolves to undefined when the row moved on', async () => {
    const db = makeDb();
    db.returning.mockResolvedValue([]);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.updateIf(7, ['pending'], { status: 'approved' })).resolves.toBeUndefined();
  });

  /**
   * An empty set is a caller bug, and matching everything would be exactly the unconditional write
   * the primitive exists to replace.
   */
  it('writes nothing at all when no status is allowed', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await expect(repo.updateIf(7, [], { status: 'approved' })).resolves.toBeUndefined();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('BookRequestRepository.claimForGrab', () => {
  it('reports the claim as taken when a row matched', async () => {
    const db = makeDb();
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForGrab(7, ['approved', 'failed'])).resolves.toBe('claimed');
    expect(written(db)).toEqual({ status: 'grabbed' });
  });

  it('reports the claim as lost when another attempt took it first', async () => {
    const db = makeDb();
    db.returning.mockResolvedValue([]);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForGrab(7, ['approved'])).resolves.toBe('moved');
  });

  /**
   * `failed` sits outside the partial unique index, so the work can be requested again while a
   * failed request still names it. Re-grabbing that failed request puts it back inside the index
   * beside the new one, and the retry path used to answer the approver with a 500.
   */
  it('reports a dedupe collision rather than throwing the unique violation at the caller', async () => {
    const db = makeDb();
    db.returning.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForGrab(7, ['failed'])).resolves.toBe('duplicate');
  });

  it('still throws anything that is not a unique violation', async () => {
    const db = makeDb();
    db.returning.mockRejectedValue(new Error('connection lost'));
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForGrab(7, ['failed'])).rejects.toThrow('connection lost');
  });
});

describe('BookRequestRepository.remove', () => {
  it('deletes nothing when no status is allowed', async () => {
    const db = { ...makeDb(), delete: vi.fn() };
    const repo = new BookRequestRepository(db as never);

    await expect(repo.remove(7, [])).resolves.toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('BookRequestRepository.create', () => {
  function makeInsertingDb() {
    const insertValues = vi.fn();
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: insertValues.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 7, dedupeKey: 'isbn13:9780441013593:ebook' }]) }),
      }),
    };
    return { db: { transaction: vi.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) }, tx, insertValues };
  }

  /** A row without its aliases is one the next requester silently fails to collide with. */
  it('writes the aliases in the same transaction as the row', async () => {
    const { db, insertValues } = makeInsertingDb();
    const repo = new BookRequestRepository(db as never);

    await repo.create({ title: 'Dune' } as never, ['isbn13:9780441013593:ebook', 'work:dune:frankherbert:ebook']);

    expect(db.transaction).toHaveBeenCalled();
    expect(insertValues).toHaveBeenLastCalledWith([{ requestId: 7, dedupeKey: 'work:dune:frankherbert:ebook' }]);
  });

  /** The key the row is already filed under is the constraint, not an alias of itself. */
  it("does not repeat the row's own key as an alias", async () => {
    const { db, insertValues } = makeInsertingDb();
    const repo = new BookRequestRepository(db as never);

    await repo.create({ title: 'Dune' } as never, ['isbn13:9780441013593:ebook']);

    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});

/**
 * Counting and then inserting is not a cap. Two submissions for different works each read nine
 * and both proceed, and the limit an operator was promised turns out to be a suggestion, so the
 * count has to happen inside the insert's own transaction behind a lock nothing else can pass.
 */
describe('BookRequestRepository.createWithinSelfServeCap', () => {
  function makeCappedDb(live: number) {
    const calls: string[] = [];
    const insertValues = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 7, dedupeKey: 'work:dune' }]) });
    const tx = {
      execute: vi.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve();
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            calls.push('count');
            return Promise.resolve([{ total: live }]);
          }),
        }),
      }),
      insert: vi.fn().mockImplementation(() => {
        calls.push('insert');
        return { values: insertValues };
      }),
    };
    return { db: { transaction: vi.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) }, tx, calls };
  }

  it('takes the lock before it counts, and inserts under the same one', async () => {
    const { db, calls } = makeCappedDb(2);
    const repo = new BookRequestRepository(db as never);

    await repo.createWithinSelfServeCap({ userId: 3, title: 'Dune' } as never, [], 10);

    expect(db.transaction).toHaveBeenCalled();
    expect(calls).toEqual(['lock', 'count', 'insert']);
  });

  it('refuses rather than inserting once the caller is at the cap', async () => {
    const { db, tx } = makeCappedDb(10);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.createWithinSelfServeCap({ userId: 3, title: 'Dune' } as never, [], 10)).resolves.toBeNull();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  /** Per user, so two people submitting at the same moment never wait on each other. */
  it('locks on the caller rather than on the whole table', async () => {
    const { db, tx } = makeCappedDb(0);
    const repo = new BookRequestRepository(db as never);

    await repo.createWithinSelfServeCap({ userId: 3, title: 'Dune' } as never, [], 10);

    const [statement] = tx.execute.mock.calls[0] as [{ queryChunks?: unknown[] }];
    expect(JSON.stringify(statement)).toContain('pg_advisory_xact_lock');
    expect(JSON.stringify(statement)).toContain('3');
  });
});

/**
 * Taking a request on is in-flight work for the caller exactly as an insert would have been, so
 * it is counted under the same lock rather than being a way around the cap.
 */
describe('BookRequestRepository.claimForSelfServe', () => {
  function makeClaimingDb(live: number, claimed: Array<{ id: number }> = [{ id: 7 }]) {
    const update = vi.fn();
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: live }]) }) }),
      update: update.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(claimed) }) }),
      }),
    };
    return { db: { transaction: vi.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) }, tx, update };
  }

  it('records the caller as the fulfiller and approves what nobody had decided on', async () => {
    const { db, tx } = makeClaimingDb(0);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForSelfServe(7, 3, ['pending', 'approved'], 10)).resolves.toEqual({ id: 7 });
    expect(tx.update.mock.results[0].value.set).toHaveBeenCalledWith(
      expect.objectContaining({ selfServe: true, fulfillerUserId: 3, status: 'approved' }),
    );
  });

  it('refuses without writing once the caller is at the cap', async () => {
    const { db, update } = makeClaimingDb(10);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForSelfServe(7, 3, ['pending'], 10)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  /** Somebody deciding on it between the read and the write wins over the claim. */
  it('resolves to null when the conditional write matched nothing', async () => {
    const { db } = makeClaimingDb(0, []);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForSelfServe(7, 3, ['pending'], 10)).resolves.toBeNull();
  });

  it('writes nothing at all when no status is allowed', async () => {
    const { db } = makeClaimingDb(0);
    const repo = new BookRequestRepository(db as never);

    await expect(repo.claimForSelfServe(7, 3, [], 10)).resolves.toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

/**
 * The list is bounded, so the search is the only thing that makes somebody past the bound
 * reachable. What matters here is that a term becomes a condition on the query at all, and that a
 * term made of wildcards is a search for those characters rather than a search for everybody.
 */
describe('BookRequestRepository.findRequesterOptions', () => {
  function makeSelectingDb() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      selectDistinct: vi.fn(),
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    for (const key of ['selectDistinct', 'from', 'innerJoin', 'where', 'orderBy']) chain[key].mockReturnValue(chain);
    chain.limit.mockResolvedValue([]);
    return chain;
  }

  /** What the condition compiles to, which is the only honest way to read a drizzle expression. */
  function compiled(condition: unknown): { sql: string; params: unknown[] } {
    return new PgDialect().sqlToQuery(condition as SQL);
  }

  it('asks for everyone when no search was given', async () => {
    const db = makeSelectingDb();
    await new BookRequestRepository(db as never).findRequesterOptions(null);

    expect(db.where).toHaveBeenCalledWith(undefined);
    expect(db.limit).toHaveBeenCalledWith(100);
  });

  it('narrows to a search term', async () => {
    const db = makeSelectingDb();
    await new BookRequestRepository(db as never).findRequesterOptions('  ada  ');

    const { sql, params } = compiled(db.where.mock.calls.at(-1)![0]);
    expect(sql).toContain('ilike');
    expect(params).toEqual(['%ada%', '%ada%']);
  });

  /** Otherwise a search for `%` is a search for everybody, silently. */
  it('escapes the wildcards a person can type', async () => {
    const db = makeSelectingDb();
    await new BookRequestRepository(db as never).findRequesterOptions('50%_off');

    expect(compiled(db.where.mock.calls.at(-1)![0]).params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%']);
  });
});

describe('BookRequestRepository.findRequestViewerIds', () => {
  function makeDb(owners: Array<{ requestId: number; userId: number }>, subscribed: Array<{ requestId: number; userId: number }>) {
    const results = [owners, subscribed];
    return {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(results.shift() ?? []) }),
      })),
    };
  }

  it('asks nothing of the database for an empty batch', async () => {
    const db = makeDb([], []);
    expect(await new BookRequestRepository(db as never).findRequestViewerIds([])).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('folds the requester in with the subscribers, once each', async () => {
    const db = makeDb(
      [
        { requestId: 3, userId: 5 },
        { requestId: 4, userId: 9 },
      ],
      [
        { requestId: 3, userId: 5 },
        { requestId: 3, userId: 6 },
      ],
    );

    const viewers = await new BookRequestRepository(db as never).findRequestViewerIds([3, 4]);

    expect(viewers.get(3)).toEqual([5, 6]);
    expect(viewers.get(4)).toEqual([9]);
  });
});
