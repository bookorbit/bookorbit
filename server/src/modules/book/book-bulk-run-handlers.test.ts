import { EMPTY_CONTENT_FILTER_RULES, Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import type { BulkItemOutcome } from '../bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BookEmbedAudioCoverBulkHandler, BookReExtractCoverBulkHandler, BookRefreshMetadataBulkHandler } from './book-bulk-run-handlers';

const keyActor: RequestUser = {
  id: 5,
  username: 'automation',
  name: 'Automation',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [Permission.LibraryEditMetadata],
  contentFilters: EMPTY_CONTENT_FILTER_RULES,
  credential: { kind: 'api_key', keyId: 1, keyName: 'Tagger', audience: 'api', access: 'write', libraryIds: [7], ownerIsSuperuser: false },
};

function run(overrides: Partial<BulkRunRow> = {}): BulkRunRow {
  const now = new Date('2026-11-15T00:00:00Z');
  return {
    id: '7d0f0d55-0000-4000-8000-000000000001',
    kind: 'book-refresh-metadata',
    requestedBy: 5,
    credentialKind: 'api_key',
    apiKeyId: 1,
    status: 'running',
    subjectIds: [1, 2, 3, 4],
    options: {},
    total: 4,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    stats: {},
    failures: [],
    errorCode: null,
    error: null,
    cancelRequested: false,
    actorUsername: 'automation',
    actorIp: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function makeBooks() {
  return {
    refreshMetadataBulkItem: vi.fn(),
    reExtractCoverBulkItem: vi.fn(),
    embedAudioCoverBulkItem: vi.fn(),
    findReadAlongBookIds: vi.fn(),
  };
}

describe('book bulk run handlers', () => {
  it('register their kinds once the module starts', () => {
    const registry = new BulkRunHandlerRegistry();
    const books = makeBooks();
    for (const Handler of [BookRefreshMetadataBulkHandler, BookReExtractCoverBulkHandler, BookEmbedAudioCoverBulkHandler]) {
      new Handler(registry, books as never).onModuleInit();
    }

    expect(registry.get('book-refresh-metadata')).toBeInstanceOf(BookRefreshMetadataBulkHandler);
    expect(registry.get('book-re-extract-cover')).toBeInstanceOf(BookReExtractCoverBulkHandler);
    expect(registry.get('book-embed-audio-cover')).toBeInstanceOf(BookEmbedAudioCoverBulkHandler);
  });

  describe('book-refresh-metadata', () => {
    function arrange() {
      const books = makeBooks();
      return { books, handler: new BookRefreshMetadataBulkHandler(new BulkRunHandlerRegistry(), books as never) };
    }

    it('refreshes as the run actor and sends the route per-book event', async () => {
      const { books, handler } = arrange();
      books.refreshMetadataBulkItem.mockResolvedValue({ status: 'success', detail: { id: 1, title: 'Dune' } });

      const outcome = await handler.processItem(1, { run: run({ options: { ignoreCache: true } }), actor: keyActor, state: null });

      expect(books.refreshMetadataBulkItem).toHaveBeenCalledWith(1, keyActor, { ignoreCache: true });
      expect(outcome).toEqual({ outcome: 'succeeded', event: { bookId: 1, success: true, detail: { id: 1, title: 'Dune' } } });
    });

    it('records a failed refresh with its message', async () => {
      const { books, handler } = arrange();
      books.refreshMetadataBulkItem.mockResolvedValue({ status: 'failed', error: 'provider timeout' });

      await expect(handler.processItem(2, { run: run(), actor: keyActor, state: null })).resolves.toEqual({
        outcome: 'failed',
        code: 'refresh-failed',
        message: 'provider timeout',
        event: { bookId: 2, success: false, error: 'provider timeout' },
      });
      expect(books.refreshMetadataBulkItem).toHaveBeenCalledWith(2, keyActor, { ignoreCache: false });
    });

    it('skips a book deleted while the run waited and still tells the page about it', async () => {
      const { books, handler } = arrange();
      books.refreshMetadataBulkItem.mockResolvedValue({ status: 'skipped', code: 'not-found' });

      await expect(handler.processItem(3, { run: run(), actor: keyActor, state: null })).resolves.toEqual({
        outcome: 'skipped',
        code: 'not-found',
        event: { bookId: 3, success: false, error: 'Book not found' },
      });
    });

    it('builds the route done event: successes as processed, every other book as failed', () => {
      const { handler } = arrange();

      expect(handler.doneEvent(run({ status: 'completed', processed: 6, succeeded: 3, failed: 2, skipped: 1 }))).toEqual({
        done: true,
        processed: 3,
        failed: 3,
      });
    });
  });

  describe('book-re-extract-cover', () => {
    function arrange() {
      const books = makeBooks();
      return { books, handler: new BookReExtractCoverBulkHandler(new BulkRunHandlerRegistry(), books as never) };
    }

    it('sends an event only for an attempted book and counts updates', async () => {
      const { books, handler } = arrange();
      books.reExtractCoverBulkItem
        .mockResolvedValueOnce({ status: 'attempted', updated: true })
        .mockResolvedValueOnce({ status: 'attempted', updated: false })
        .mockResolvedValueOnce({ status: 'no-source' })
        .mockResolvedValueOnce({ status: 'locked' })
        .mockResolvedValueOnce({ status: 'skipped', code: 'no-access' });
      const context = { run: run({ kind: 'book-re-extract-cover' }), actor: keyActor, state: null };

      const outcomes: BulkItemOutcome[] = [];
      for (const id of [1, 2, 3, 4, 5]) outcomes.push(await handler.processItem(id, context));

      expect(books.reExtractCoverBulkItem).toHaveBeenCalledWith(1, keyActor);
      expect(outcomes).toEqual([
        { outcome: 'succeeded', stats: { updated: 1 }, event: { bookId: 1 } },
        { outcome: 'succeeded', stats: undefined, event: { bookId: 2 } },
        { outcome: 'skipped', code: 'no-cover-source' },
        { outcome: 'skipped', code: 'locked' },
        { outcome: 'skipped', code: 'no-access' },
      ]);
    });

    it('builds the route done event: attempts as processed, plus updated', () => {
      const { handler } = arrange();

      expect(handler.doneEvent(run({ kind: 'book-re-extract-cover', status: 'completed', succeeded: 4, skipped: 2, stats: { updated: 3 } }))).toEqual(
        {
          done: true,
          processed: 4,
          updated: 3,
        },
      );
      expect(handler.doneEvent(run({ kind: 'book-re-extract-cover', status: 'cancelled' }))).toEqual({ done: true, processed: 0, updated: 0 });
    });
  });

  describe('book-embed-audio-cover', () => {
    function arrange() {
      const books = makeBooks();
      return { books, handler: new BookEmbedAudioCoverBulkHandler(new BulkRunHandlerRegistry(), books as never) };
    }

    it('counts the read-along books still to do and announces them as started', async () => {
      const { books, handler } = arrange();
      books.findReadAlongBookIds.mockResolvedValue(new Set([3, 4]));
      const resumed = run({ kind: 'book-embed-audio-cover', processed: 2 });

      const prepared = await handler.prepare(resumed);

      expect(books.findReadAlongBookIds).toHaveBeenCalledWith([3, 4]);
      expect(handler.startEvent(resumed, prepared.state)).toEqual({ started: true, total: 2 });
    });

    it('skips a book without a read-along EPUB silently and reports each visited book', async () => {
      const { books, handler } = arrange();
      books.embedAudioCoverBulkItem
        .mockResolvedValueOnce({ status: 'success', code: 'embedded', fieldsWritten: ['audioCoverBytes'], durationMs: 1 })
        .mockResolvedValueOnce({ status: 'failed', code: 'failed', fieldsWritten: [], durationMs: 0, reason: 'disk full' })
        .mockResolvedValueOnce({ status: 'skipped', code: 'not-found', fieldsWritten: [], durationMs: 0, reason: 'book not found' });
      const context = { run: run({ kind: 'book-embed-audio-cover' }), actor: keyActor, state: { candidates: new Set([2, 3, 4]) } };

      const outcomes: BulkItemOutcome[] = [];
      for (const id of [1, 2, 3, 4]) outcomes.push(await handler.processItem(id, context));

      expect(books.embedAudioCoverBulkItem.mock.calls).toEqual([
        [2, keyActor],
        [3, keyActor],
        [4, keyActor],
      ]);
      expect(outcomes).toEqual([
        { outcome: 'skipped', code: 'no_read_along_file' },
        { outcome: 'succeeded', event: { bookId: 2, status: 'success', reason: undefined } },
        { outcome: 'failed', code: 'failed', message: 'disk full', event: { bookId: 3, status: 'failed', reason: 'disk full' } },
        { outcome: 'skipped', code: 'not-found', event: { bookId: 4, status: 'skipped', reason: 'book not found' } },
      ]);
    });

    it('builds the route done event from the settled run, cancelled included', () => {
      const { handler } = arrange();

      expect(
        handler.doneEvent(run({ kind: 'book-embed-audio-cover', status: 'completed', processed: 4, succeeded: 1, failed: 1, skipped: 2 })),
      ).toEqual({
        done: true,
        processed: 4,
        succeeded: 1,
        failed: 1,
        skipped: 2,
        cancelled: false,
      });
      expect(handler.doneEvent(run({ kind: 'book-embed-audio-cover', status: 'cancelled', processed: 1, succeeded: 1 }))).toEqual({
        done: true,
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: true,
      });
    });
  });
});
