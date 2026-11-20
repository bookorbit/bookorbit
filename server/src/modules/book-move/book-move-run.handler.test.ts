import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BookMoveRunHandler } from './book-move-run.handler';
import type { BookMoveRunState, BookMoveService } from './book-move.service';

const ACTOR = { id: 7, username: 'mover' } as RequestUser;

function run(change: Partial<BulkRunRow> = {}): BulkRunRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'book-move',
    requestedBy: 7,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'completed',
    subjectIds: [1, 2, 3],
    options: { targetLibraryId: 2, targetFolderId: 22, collisionPolicy: 'suggested', overrides: [], sourceLibraryIds: [1] },
    total: 3,
    processed: 3,
    succeeded: 2,
    failed: 0,
    skipped: 1,
    stats: { merged: 1 },
    failures: [],
    errorCode: null,
    error: null,
    cancelRequested: false,
    actorUsername: 'mover',
    actorIp: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    dismissedAt: null,
    ...change,
  };
}

function setup() {
  const state = { jobId: 101 } as BookMoveRunState;
  const moves = {
    prepareRun: vi.fn().mockResolvedValue({ state }),
    moveOne: vi.fn().mockResolvedValue({ outcome: 'succeeded', event: { bookId: 1, status: 'success' } }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    isContinuable: vi.fn().mockReturnValue(false),
  };
  const registry = new BulkRunHandlerRegistry();
  const handler = new BookMoveRunHandler(registry, moves as unknown as BookMoveService);
  return { handler, moves, registry, state };
}

describe('BookMoveRunHandler', () => {
  it('registers the book-move kind on init', () => {
    const { handler, registry } = setup();

    handler.onModuleInit();

    expect(registry.get('book-move')).toBe(handler);
  });

  it('prepares, moves and finishes through the move service', async () => {
    const { handler, moves, state } = setup();
    const row = run({ status: 'running' });

    await expect(handler.prepare(row, ACTOR)).resolves.toEqual({ state });
    await expect(handler.processItem(1, { run: row, actor: ACTOR, state })).resolves.toEqual({
      outcome: 'succeeded',
      event: { bookId: 1, status: 'success' },
    });
    await handler.finish(row, state, 'cancelled');
    await handler.finish(row, null, 'failed');

    expect(moves.prepareRun).toHaveBeenCalledWith(row, ACTOR);
    expect(moves.moveOne).toHaveBeenCalledWith(1, state, ACTOR);
    expect(moves.finishRun).toHaveBeenNthCalledWith(1, row, state, 'cancelled');
    expect(moves.finishRun).toHaveBeenNthCalledWith(2, row, null, 'failed');
  });

  it('passes a busy answer through so the run stays in line', async () => {
    const { handler, moves } = setup();
    moves.prepareRun.mockResolvedValue('busy');

    await expect(handler.prepare(run({ status: 'running' }), ACTOR)).resolves.toBe('busy');
  });

  it('builds the route done event from the settled run', () => {
    const { handler } = setup();

    expect(handler.doneEvent(run())).toEqual({ done: true, processed: 3, succeeded: 1, merged: 1, failed: 0, skipped: 1, cancelled: false });
    expect(handler.doneEvent(run({ status: 'cancelled', processed: 1, succeeded: 1, skipped: 0, stats: {} }))).toEqual({
      done: true,
      processed: 1,
      succeeded: 1,
      merged: 0,
      failed: 0,
      skipped: 0,
      cancelled: true,
    });
  });

  it('offers Continue only when the move service says the boot rescan is done', () => {
    const { handler, moves } = setup();
    const row = run({ status: 'interrupted' });

    expect(handler.continuable(row)).toBe(false);
    moves.isContinuable.mockReturnValue(true);
    expect(handler.continuable(row)).toBe(true);
    expect(moves.isContinuable).toHaveBeenCalledWith(row);
  });
});
