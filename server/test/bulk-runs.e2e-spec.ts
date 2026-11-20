import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { BULK_RUN_ID_HEADER, BULK_RUN_MAX_UNFINISHED, Permission, type BulkRunKind, type JobActionResponse, type JobList } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { BulkRunDispatcher } from '../src/modules/bulk-runs/bulk-run-dispatcher.service';
import type { BulkItemOutcome, BulkRunItemContext } from '../src/modules/bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../src/modules/bulk-runs/bulk-run-handler.registry';
import { createEpubFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const RE_EXTRACT = '/api/v1/books/bulk-re-extract-cover';

interface Followed {
  runId: string;
  status: number;
  /** Every event the stream carried, once it ends. */
  events: Promise<object[]>;
  abort: () => void;
}

/**
 * Bulk runs outlive the request that started them: a disconnect only detaches, a cancel stops
 * before the next item, accounts take turns, a restart leaves runs to continue, and a revoked key
 * stops its run. Items are held at a gate so each case decides when the run moves on.
 */
describe('Bulk runs (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let origin!: string;
  let library!: CreatedLibrary;
  let books!: number[];
  let editor!: TestUserSession;
  let otherEditor!: TestUserSession;
  let keyOwner!: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder' });
    const paths: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const title = `Bulk ${randomUUID().slice(0, 6)}`;
      paths.push(await createEpubFixture(library.folderPath, `Author ${randomUUID().slice(0, 6)}/${title}/${title}.epub`, { title }));
    }
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    books = [];
    for (const path of paths) books.push((await locateBookByAbsolutePath(ctx, path)).bookId);

    editor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    otherEditor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    keyOwner = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata, Permission.ApiKeys] });
    for (const user of [editor, otherEditor, keyOwner]) await grantLibraryAccess(ctx, user.userId, library.libraryId, 'editor');

    await ctx.app.listen(0, '127.0.0.1');
    origin = await ctx.app.getUrl();
  });

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  /** Gates still shut when a case ends; opened so a failed case never blocks the next one. */
  const gates: Array<() => void> = [];

  afterEach(async () => {
    for (const open of gates.splice(0)) open();
    vi.restoreAllMocks();
    await waitFor(() => expect(ctx.app.get(BulkRunDispatcher).activeRunIds).toEqual([]));
  }, 30_000);

  /** Holds every item of a kind until `release`, recording which ids started. */
  function holdItems(kind: BulkRunKind) {
    const handler = ctx.app.get(BulkRunHandlerRegistry).get(kind)!;
    const original = handler.processItem.bind(handler);
    const started: number[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    gates.push(() => open());
    vi.spyOn(handler, 'processItem').mockImplementation(async (id: number, context: BulkRunItemContext<unknown>): Promise<BulkItemOutcome> => {
      started.push(id);
      await gate;
      return await original(id, context);
    });
    return { started, release: () => open() };
  }

  /** Starts a run over a real connection, so the client can leave mid-stream. */
  async function start(path: string, headers: Record<string, string>, payload: object): Promise<Followed> {
    const controller = new AbortController();
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const runId = response.headers.get(BULK_RUN_ID_HEADER.toLowerCase()) ?? '';
    const events = response
      .text()
      .then((body) =>
        body
          .split('\n\n')
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.startsWith('data: '))
          .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as object),
      )
      .catch(() => [] as object[]);
    return { runId, status: response.status, events, abort: () => controller.abort() };
  }

  async function run(runId: string) {
    const [row] = await ctx.db.select().from(schema.bulkRuns).where(eq(schema.bulkRuns.id, runId));
    return row!;
  }

  async function act(user: TestUserSession | string, action: string, runId: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/jobs/actions',
      headers: authHeader(typeof user === 'string' ? user : user.accessToken),
      payload: { action, ids: [`bulk-run:${runId}`] },
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as JobActionResponse).results[0]!;
  }

  async function waitFor(check: () => unknown, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await check();
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  const waitForStatus = (runId: string, status: string) => waitFor(async () => expect((await run(runId)).status).toBe(status));

  it('keeps working after the client disconnects', async () => {
    const held = holdItems('book-re-extract-cover');
    const followed = await start(RE_EXTRACT, authHeader(editor.accessToken), { bookIds: [books[0], books[1]] });
    expect(followed.status).toBe(200);
    expect(followed.runId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(held.started).toHaveLength(1));

    followed.abort();
    await new Promise((resolve) => setTimeout(resolve, 200));
    held.release();

    await waitForStatus(followed.runId, 'completed');
    const settled = await run(followed.runId);
    expect(settled).toMatchObject({ processed: 2, total: 2, cancelRequested: false, subjectIds: [] });
  });

  it('stops within one item of a cancel and ends the stream with done', async () => {
    const held = holdItems('book-re-extract-cover');
    const followed = await start(RE_EXTRACT, authHeader(editor.accessToken), { bookIds: [books[0], books[1], books[2]] });
    await waitFor(() => expect(held.started).toHaveLength(1));

    expect(await act(editor, 'cancel', followed.runId)).toMatchObject({ outcome: 'done' });
    held.release();

    await waitForStatus(followed.runId, 'cancelled');
    expect((await run(followed.runId)).processed).toBe(1);
    expect(held.started).toHaveLength(1);
    const events = await followed.events;
    expect(events.at(-1)).toMatchObject({ done: true });
  });

  it("queues an account's second run while another account's run starts", async () => {
    const held = holdItems('book-re-extract-cover');
    const first = await start(RE_EXTRACT, authHeader(editor.accessToken), { bookIds: [books[0]] });
    await waitForStatus(first.runId, 'running');
    const second = await start(RE_EXTRACT, authHeader(editor.accessToken), { bookIds: [books[1]] });
    const other = await start(RE_EXTRACT, authHeader(otherEditor.accessToken), { bookIds: [books[2]] });

    await waitForStatus(other.runId, 'running');
    expect((await run(second.runId)).status).toBe('queued');

    const queue = await ctx.app.inject({ method: 'GET', url: '/api/v1/jobs?type=bulk-run', headers: authHeader(editor.accessToken) });
    expect(queue.statusCode, queue.body).toBe(200);
    const mine = (queue.json() as JobList).items;
    expect(mine.map((item) => [item.id, item.status, item.position])).toEqual([
      [`bulk-run:${first.runId}`, 'running', null],
      [`bulk-run:${second.runId}`, 'queued', 1],
    ]);

    held.release();
    for (const runId of [first.runId, second.runId, other.runId]) await waitForStatus(runId, 'completed');
    await Promise.all([first.events, second.events, other.events]);
  });

  it('refuses an eleventh unfinished run before the stream, and never counts the single re-extract', async () => {
    const now = new Date();
    const base = { kind: 'book-re-extract-cover', requestedBy: editor.userId, credentialKind: 'session', subjectIds: [books[0]!], total: 1 } as const;
    // A running run this server never claimed holds the account's turn, so the waiting ones stay put.
    const seeded = await ctx.db
      .insert(schema.bulkRuns)
      .values([
        { ...base, status: 'running', startedAt: now },
        ...Array.from({ length: BULK_RUN_MAX_UNFINISHED - 1 }, () => ({ ...base, status: 'queued' as const })),
      ])
      .returning({ id: schema.bulkRuns.id });
    try {
      const refused = await ctx.app.inject({
        method: 'POST',
        url: RE_EXTRACT,
        headers: authHeader(editor.accessToken),
        payload: { bookIds: [books[1]] },
      });
      expect(refused.statusCode, refused.body).toBe(429);
      expect(refused.headers['content-type']).not.toContain('text/event-stream');

      const before = await countRunsFor(editor.userId);
      const single = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${books[1]}/re-extract-cover`,
        headers: authHeader(editor.accessToken),
      });
      expect([200, 201, 409], single.body).toContain(single.statusCode);
      expect(single.headers['content-type']).not.toContain('text/event-stream');
      expect(await countRunsFor(editor.userId)).toBe(before);
    } finally {
      for (const row of seeded) await ctx.db.delete(schema.bulkRuns).where(eq(schema.bulkRuns.id, row.id));
    }
  });

  async function countRunsFor(userId: number): Promise<number> {
    return (await ctx.db.select({ id: schema.bulkRuns.id }).from(schema.bulkRuns).where(eq(schema.bulkRuns.requestedBy, userId))).length;
  }

  it('marks a run cut short by a restart interrupted, and Continue resumes where it stopped', async () => {
    const [seeded] = await ctx.db
      .insert(schema.bulkRuns)
      .values({
        kind: 'book-re-extract-cover',
        requestedBy: editor.userId,
        credentialKind: 'session',
        status: 'running',
        subjectIds: [books[0]!, books[1]!],
        total: 2,
        processed: 1,
        succeeded: 1,
        startedAt: new Date(),
      })
      .returning({ id: schema.bulkRuns.id });
    const runId = seeded!.id;
    await ctx.app.get(BulkRunDispatcher).onApplicationBootstrap();
    expect(await run(runId)).toMatchObject({ status: 'interrupted', processed: 1, subjectIds: [books[0], books[1]] });

    const failed = await ctx.app.inject({ method: 'GET', url: '/api/v1/jobs?view=failed&type=bulk-run', headers: authHeader(editor.accessToken) });
    const row = (failed.json() as JobList).items.find((item) => item.id === `bulk-run:${runId}`);
    expect(row).toMatchObject({ status: 'failed', reason: 'interrupted', done: 1, total: 2, actions: ['continue', 'dismiss'] });

    const handler = ctx.app.get(BulkRunHandlerRegistry).get('book-re-extract-cover')!;
    const items = vi.spyOn(handler, 'processItem');
    expect(await act(editor, 'continue', runId)).toMatchObject({ outcome: 'done' });
    await waitForStatus(runId, 'completed');
    expect(items.mock.calls.map(([id]) => id)).toEqual([books[1]]);
    expect(await run(runId)).toMatchObject({ processed: 2, subjectIds: [] });
  });

  it('stops a key run once its key is revoked', async () => {
    const settings = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/app-settings/api-keys',
      headers: authHeader(ctx.adminToken),
      payload: { enabled: true, maxLifetimeDays: null },
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: authHeader(keyOwner.accessToken),
      payload: { name: 'Cover script', access: 'write', permissions: [Permission.LibraryEditMetadata] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { key, token } = created.json() as { key: { id: number }; token: string };

    const held = holdItems('book-re-extract-cover');
    const ahead = await start(RE_EXTRACT, authHeader(keyOwner.accessToken), { bookIds: [books[0]] });
    await waitForStatus(ahead.runId, 'running');
    const keyed = await start(RE_EXTRACT, { 'x-api-key': token }, { bookIds: [books[1], books[2]] });
    expect(keyed.status).toBe(200);
    expect(await run(keyed.runId)).toMatchObject({ status: 'queued', credentialKind: 'api_key', apiKeyId: key.id });

    await waitFor(async () => {
      const [entry] = await ctx.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.userId, keyOwner.userId), eq(schema.auditLog.apiKeyId, key.id)))
        .orderBy(desc(schema.auditLog.id))
        .limit(1);
      expect(entry?.meta).toMatchObject({ bulkRunId: keyed.runId, count: 2 });
    });

    const revoked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/api-keys/${key.id}`, headers: authHeader(keyOwner.accessToken) });
    expect(revoked.statusCode, revoked.body).toBeLessThan(300);
    held.release();

    await waitForStatus(keyed.runId, 'failed');
    expect(await run(keyed.runId)).toMatchObject({ errorCode: 'credential-revoked', processed: 0 });
    expect((await keyed.events).some((event) => 'done' in event)).toBe(false);
    await waitForStatus(ahead.runId, 'completed');
  });

  it('skips a book deleted while its run waited, instead of failing the run', async () => {
    const title = `Doomed ${randomUUID().slice(0, 6)}`;
    const path = await createEpubFixture(library.folderPath, `Author ${randomUUID().slice(0, 6)}/${title}/${title}.epub`, { title });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const doomed = (await locateBookByAbsolutePath(ctx, path)).bookId;

    const held = holdItems('book-re-extract-cover');
    const ahead = await start(RE_EXTRACT, authHeader(otherEditor.accessToken), { bookIds: [books[0]] });
    await waitForStatus(ahead.runId, 'running');
    const waiting = await start(RE_EXTRACT, authHeader(otherEditor.accessToken), { bookIds: [doomed, books[1]] });
    expect((await run(waiting.runId)).status).toBe('queued');

    await ctx.db.delete(schema.books).where(eq(schema.books.id, doomed));
    held.release();

    await waitForStatus(waiting.runId, 'completed');
    const settled = await run(waiting.runId);
    expect(settled).toMatchObject({ processed: 2, skipped: 1, failed: 0 });
    expect((await waiting.events).at(-1)).toMatchObject({ done: true });
    await waitForStatus(ahead.runId, 'completed');
  });

  it('keeps moving books after the tab closes, and records a cancelled move as cancelled', async () => {
    const source = await createLibraryWithFolder(ctx, { mode: 'book_per_file' });
    const target = await createLibraryWithFolder(ctx, { mode: 'book_per_file' });
    const titles = ['Move One', 'Move Two', 'Move Three'].map((title) => `${title} ${randomUUID().slice(0, 6)}`);
    const paths: string[] = [];
    for (const title of titles) paths.push(await createEpubFixture(source.folderPath, `${title}.epub`, { title, uid: title }));
    await triggerAndWaitForLibraryScan(ctx, source.libraryId);
    const moving: number[] = [];
    for (const path of paths) moving.push((await locateBookByAbsolutePath(ctx, path)).bookId);

    const held = holdItems('book-move');
    const followed = await start('/api/v1/books/move', authHeader(ctx.adminToken), {
      selection: { bookIds: moving },
      targetLibraryId: target.libraryId,
      targetFolderId: target.libraryFolderId,
      collisionPolicy: 'skip',
    });
    expect(followed.status).toBe(200);
    await waitFor(() => expect(held.started).toHaveLength(1));
    followed.abort();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await run(followed.runId)).status).toBe('running');

    expect(await act(ctx.adminToken, 'cancel', followed.runId)).toMatchObject({ outcome: 'done' });
    held.release();

    await waitForStatus(followed.runId, 'cancelled');
    expect(await run(followed.runId)).toMatchObject({ kind: 'book-move', processed: 1, succeeded: 1 });
    const placed = await ctx.db
      .select({ id: schema.books.id, libraryId: schema.books.libraryId })
      .from(schema.books)
      .where(inArray(schema.books.id, moving));
    const libraryOf = new Map(placed.map((row) => [row.id, row.libraryId]));
    expect(moving.map((id) => libraryOf.get(id))).toEqual(moving.map((id) => (id === held.started[0] ? target.libraryId : source.libraryId)));
    const [job] = await ctx.db.select().from(schema.bookMoveJobs).orderBy(desc(schema.bookMoveJobs.id)).limit(1);
    expect(job?.status).not.toBe('running');
  });
});
