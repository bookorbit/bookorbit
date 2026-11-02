import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../db/schema';
import { smartScopes } from '../../db/schema';
import { SmartScopeRepository } from './smart-scope.repository';

type CapturedQuery = { text: string; values: unknown[] };

// A real drizzle instance over a stub pg client: the queries below are never executed
// against a server, but they are compiled by the real dialect, so the assertions are on
// the SQL that production would actually send.
function makeCapturingRepo(rows: unknown[][] = []) {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (config: { text: string }, values: unknown[] = []) => {
      queries.push({ text: config.text, values });
      return Promise.resolve({ rows, fields: [{ name: 'smartScopeId' }] });
    },
  };
  return { repo: new SmartScopeRepository(drizzle({ client: client as never, schema }) as never), queries };
}

function compile(query: unknown): CapturedQuery {
  const { sql, params } = (query as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
  return { text: sql, values: params };
}

describe('SmartScopeRepository Kobo sync selection', () => {
  it("matches a user's own flagged scopes and the shared scopes they opted into", () => {
    const { repo } = makeCapturingRepo();

    const { text, values } = compile(repo.findKoboSyncScopesForUser(9));

    expect(text).toContain('"smart_scopes"."user_id" = $1 and "smart_scopes"."sync_to_kobo" = $2');
    expect(text).toContain('"smart_scopes"."user_id" <> $3 and "smart_scopes"."is_public" = $4');
    expect(text).toContain(
      'exists (select 1 from "smart_scope_kobo_subscriptions" where ("smart_scope_kobo_subscriptions"."smart_scope_id" = "smart_scopes"."id" and "smart_scope_kobo_subscriptions"."user_id" = $5)',
    );
    expect(values).toEqual([9, true, 9, true, 9]);
  });

  it("never consults the owner flag for shared scopes, so opting in is the subscriber's decision alone", () => {
    const { repo } = makeCapturingRepo();

    const { text } = compile(repo.findKoboSyncScopesForUser(9));
    const whereClause = text.slice(text.indexOf(' where '));

    // One occurrence only: the owned branch. The shared branch is gated on is_public + subscription.
    expect(whereClause.match(/sync_to_kobo/g)).toHaveLength(1);
  });

  it('requires the scope to still be shared, so unsharing stops sync even with a subscription row', () => {
    const { repo } = makeCapturingRepo();

    const { text } = compile(repo.findKoboSyncScopesForUser(9));
    const sharedBranch = text.slice(text.indexOf('user_id" <> '));

    expect(sharedBranch).toContain('is_public');
    expect(sharedBranch).toContain('smart_scope_kobo_subscriptions');
  });

  it('reads subscribed ids scoped to the user and the requested scopes', async () => {
    const { repo, queries } = makeCapturingRepo([[5], [6]]);

    await expect(repo.findKoboSubscribedScopeIds(9, [5, 6, 7])).resolves.toEqual([5, 6]);
    expect(queries[0]?.text).toContain('from "smart_scope_kobo_subscriptions"');
    expect(queries[0]?.text).toContain('"smart_scope_kobo_subscriptions"."user_id" = $1');
    expect(queries[0]?.text).toContain('"smart_scope_kobo_subscriptions"."smart_scope_id" in ($2, $3, $4)');
    expect(queries[0]?.values).toEqual([9, 5, 6, 7]);
  });

  it('skips the query entirely when there are no scopes to check', async () => {
    const { repo, queries } = makeCapturingRepo();

    await expect(repo.findKoboSubscribedScopeIds(9, [])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("subscribes idempotently and unsubscribes only the caller's own row", async () => {
    const { repo, queries } = makeCapturingRepo();

    await repo.subscribeToKobo(9, 5);
    await repo.unsubscribeFromKobo(9, 5);

    expect(queries[0]?.text).toContain('insert into "smart_scope_kobo_subscriptions"');
    expect(queries[0]?.text).toContain('on conflict do nothing');
    expect(queries[0]?.values).toEqual([9, 5]);
    expect(queries[1]?.text).toContain('delete from "smart_scope_kobo_subscriptions"');
    expect(queries[1]?.text).toContain('"smart_scope_kobo_subscriptions"."user_id" = $1');
    expect(queries[1]?.values).toEqual([9, 5]);
  });
});

describe('SmartScopeRepository', () => {
  it('builds find/update/delete queries and counts display-order updates inside a transaction', async () => {
    const findAllOrderBy = vi.fn().mockReturnValue('find-all-query');
    const findByIdLimit = vi.fn().mockResolvedValue([{ id: 1 }]);
    const where = vi.fn().mockReturnValue({ orderBy: findAllOrderBy, limit: findByIdLimit });
    const from = vi.fn().mockReturnValue({ where });

    const insertReturning = vi.fn().mockResolvedValue([{ id: 2 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const insert = vi.fn().mockReturnValue({ values: insertValues });

    const updateReturning = vi.fn().mockResolvedValue([{ id: 3 }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set: updateSet });

    const deleteReturning = vi.fn().mockResolvedValue([{ id: 4 }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const txReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([]);
    const txWhere = vi.fn().mockReturnValue({ returning: txReturning });
    const txSet = vi.fn().mockReturnValue({ where: txWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });
    const transaction = vi
      .fn()
      .mockImplementation(async (callback: (tx: { update: typeof txUpdate }) => Promise<number>) => callback({ update: txUpdate }));

    const db = {
      select: vi.fn().mockReturnValue({ from }),
      insert,
      update,
      delete: deleteFn,
      transaction,
    };

    const repo = new SmartScopeRepository(db as never);

    expect(repo.findAllForUser(9)).toBe('find-all-query');
    expect(findAllOrderBy).toHaveBeenCalledWith(smartScopes.displayOrder, smartScopes.name);

    await expect(repo.findById(1)).resolves.toEqual([{ id: 1 }]);
    await expect(repo.insert({ userId: 9, name: 'Favorites' } as never)).resolves.toEqual([{ id: 2 }]);
    await expect(repo.update(3, 9, { name: 'Renamed' })).resolves.toEqual([{ id: 3 }]);
    await expect(repo.delete(4, 9)).resolves.toEqual([{ id: 4 }]);

    const updatedCount = await repo.updateDisplayOrders(9, [
      { id: 100, displayOrder: 0 },
      { id: 101, displayOrder: 1 },
    ]);
    expect(updatedCount).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
  });
});
