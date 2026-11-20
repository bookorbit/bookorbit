import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { AuthorBulkRefreshHandler, type AuthorBulkRefreshState } from './author-bulk-refresh.handler';

function actor(id = 7): RequestUser {
  return {
    id,
    username: 'editor',
    name: 'Editor',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function run(overrides: Partial<BulkRunRow> = {}): BulkRunRow {
  const now = new Date('2026-11-15T00:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'author-refresh-metadata',
    requestedBy: 7,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'running',
    subjectIds: [1, 2, 3],
    options: {},
    total: 3,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    stats: {},
    failures: [],
    errorCode: null,
    error: null,
    cancelRequested: false,
    actorUsername: 'editor',
    actorIp: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function setup() {
  const registry = { register: vi.fn() };
  const scope = { libraryIds: [1], editableLibraryIds: new Set([1]) };
  const authors = {
    bulkRefreshScope: vi.fn().mockResolvedValue(scope),
    bulkRefreshItemAccess: vi.fn().mockResolvedValue('ok'),
    refreshAuthorForBulk: vi.fn(),
    pauseBetweenBulkAuthors: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new AuthorBulkRefreshHandler(registry as never, authors as never);
  return { handler, registry, authors, scope };
}

async function prepared(handler: AuthorBulkRefreshHandler, row: BulkRunRow): Promise<AuthorBulkRefreshState> {
  const result = await handler.prepare(row);
  return result.state;
}

describe('AuthorBulkRefreshHandler', () => {
  it('registers its kind on init', () => {
    const { handler, registry } = setup();
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
    expect(handler.kind).toBe('author-refresh-metadata');
  });

  it('reads ignoreCache from the run options', async () => {
    const { handler } = setup();
    await expect(prepared(handler, run({ options: { ignoreCache: true } }))).resolves.toEqual({ ignoreCache: true, scope: null, previous: null });
    await expect(prepared(handler, run())).resolves.toEqual(expect.objectContaining({ ignoreCache: false }));
  });

  it('refreshes an author and sends the route event, counting an update', async () => {
    const { handler, authors, scope } = setup();
    const row = run({ options: { ignoreCache: true } });
    const state = await prepared(handler, row);
    authors.refreshAuthorForBulk.mockResolvedValue({
      kind: 'refreshed',
      updated: true,
      imageUpdated: true,
      imageUrl: '/thumb/1',
      outboundRequests: 2,
    });

    const outcome = await handler.processItem(1, { run: row, actor: actor(), state });

    expect(outcome).toEqual({
      outcome: 'succeeded',
      stats: { updated: 1 },
      event: { authorId: 1, updated: true, imageUpdated: true, imageUrl: '/thumb/1' },
    });
    expect(authors.bulkRefreshItemAccess).toHaveBeenCalledWith(1, scope);
    expect(authors.refreshAuthorForBulk).toHaveBeenCalledWith(1, true, 7);
    expect(authors.pauseBetweenBulkAuthors).not.toHaveBeenCalled();
  });

  it('counts an unchanged author as a success without an update', async () => {
    const { handler, authors } = setup();
    const row = run();
    const state = await prepared(handler, row);
    authors.refreshAuthorForBulk.mockResolvedValue({
      kind: 'refreshed',
      updated: false,
      imageUpdated: false,
      imageUrl: undefined,
      outboundRequests: 0,
    });

    const outcome = await handler.processItem(1, { run: row, actor: actor(), state });

    expect(outcome.outcome).toBe('succeeded');
    expect(outcome.stats).toBeUndefined();
    expect(JSON.stringify(outcome.event)).toBe(JSON.stringify({ authorId: 1, updated: false, imageUpdated: false }));
  });

  it('records a failed author with its error, in the route event shape', async () => {
    const { handler, authors } = setup();
    const row = run();
    const state = await prepared(handler, row);
    authors.refreshAuthorForBulk.mockResolvedValue({ kind: 'failed', error: 'provider timeout' });

    const outcome = await handler.processItem(1, { run: row, actor: actor(), state });

    expect(outcome).toEqual({
      outcome: 'failed',
      code: 'refresh-failed',
      message: 'provider timeout',
      event: { authorId: 1, updated: false, imageUpdated: false, error: 'provider timeout' },
    });
  });

  it('skips an author deleted while the run waited, or one now out of reach', async () => {
    const { handler, authors } = setup();
    const row = run();
    const state = await prepared(handler, row);
    authors.bulkRefreshItemAccess.mockResolvedValueOnce('not-found').mockResolvedValueOnce('no-access');
    authors.refreshAuthorForBulk.mockResolvedValueOnce({ kind: 'not-found' });

    const gone = await handler.processItem(1, { run: row, actor: actor(), state });
    const unreachable = await handler.processItem(2, { run: row, actor: actor(), state });
    const deletedSinceCheck = await handler.processItem(3, { run: row, actor: actor(), state });

    expect(gone).toEqual({
      outcome: 'skipped',
      code: 'not-found',
      event: { authorId: 1, updated: false, imageUpdated: false, error: 'Author not found' },
    });
    expect(unreachable).toEqual(expect.objectContaining({ outcome: 'skipped', code: 'no-access' }));
    expect(deletedSinceCheck).toEqual(expect.objectContaining({ outcome: 'skipped', code: 'not-found' }));
    expect(authors.refreshAuthorForBulk).toHaveBeenCalledTimes(1);
  });

  it('pauses before each author after the first, paced by the one before', async () => {
    const { handler, authors } = setup();
    const row = run();
    const state = await prepared(handler, row);
    authors.refreshAuthorForBulk
      .mockResolvedValueOnce({ kind: 'refreshed', updated: true, imageUpdated: false, imageUrl: undefined, outboundRequests: 0 })
      .mockResolvedValueOnce({ kind: 'failed', error: 'down' })
      .mockResolvedValueOnce({ kind: 'refreshed', updated: true, imageUpdated: false, imageUrl: undefined, outboundRequests: 3 });

    for (const id of [1, 2, 3]) await handler.processItem(id, { run: row, actor: actor(), state });

    expect(authors.pauseBetweenBulkAuthors.mock.calls).toEqual([[0], [undefined]]);
  });

  it('works out the library scope once per actor and again when the run refreshes it', async () => {
    const { handler, authors } = setup();
    const row = run();
    const state = await prepared(handler, row);
    authors.refreshAuthorForBulk.mockResolvedValue({
      kind: 'refreshed',
      updated: false,
      imageUpdated: false,
      imageUrl: undefined,
      outboundRequests: 0,
    });
    const first = actor();
    const refreshed = actor();

    await handler.processItem(1, { run: row, actor: first, state });
    await handler.processItem(2, { run: row, actor: first, state });
    await handler.processItem(3, { run: row, actor: refreshed, state });

    expect(authors.bulkRefreshScope.mock.calls).toEqual([[first], [refreshed]]);
  });

  it('rebuilds the route done event from the settled run, counting skipped authors as failed', () => {
    const { handler } = setup();
    expect(handler.doneEvent(run({ status: 'completed', processed: 5, succeeded: 2, failed: 2, skipped: 1, stats: { updated: 2 } }))).toEqual({
      done: true,
      processed: 5,
      failed: 3,
      updated: 2,
    });
    expect(handler.doneEvent(run({ status: 'completed', processed: 0 }))).toEqual({ done: true, processed: 0, failed: 0, updated: 0 });
  });
});
