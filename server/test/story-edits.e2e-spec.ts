import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';

import { SERVER_FEATURES, STORY_EDITS_PER_BOOK_MAX, type StoryEdit, type StoryEditsPage } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { BookRepository } from '../src/modules/book/book.repository';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

describe('Story edits (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let libraryId!: number;
  let bookA!: LocatedBookFile;
  let bookB!: LocatedBookFile;
  let owner!: TestUserSession;
  let peer!: TestUserSession;
  let outsider!: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: `story-edits-${randomUUID()}` });
    libraryId = library.libraryId;
    const pathA = await createEpubFixture(library.folderPath, 'story-a.epub', { title: `Story A ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` });
    const pathB = await createEpubFixture(library.folderPath, 'story-b.epub', { title: `Story B ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    bookA = await locateBookByAbsolutePath(ctx, pathA);
    bookB = await locateBookByAbsolutePath(ctx, pathB);

    owner = await createUserAndLogin(ctx);
    peer = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, owner.userId, library.libraryId, 'viewer');
    await grantLibraryAccess(ctx, peer.userId, library.libraryId, 'viewer');
  }, 120_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  function put(user: TestUserSession, bookId: number, id: string, payload: Record<string, unknown>) {
    return ctx.app.inject({ method: 'PUT', url: `/api/v1/mobile/books/${bookId}/story-edits/${id}`, headers: authHeader(user.accessToken), payload });
  }

  function get(user: TestUserSession, bookId: number, query = '') {
    return ctx.app.inject({ method: 'GET', url: `/api/v1/mobile/books/${bookId}/story-edits${query}`, headers: authHeader(user.accessToken) });
  }

  async function page(user: TestUserSession, bookId: number, query = ''): Promise<StoryEditsPage> {
    const response = await get(user, bookId, query);
    expect(response.statusCode).toBe(200);
    return response.json() as StoryEditsPage;
  }

  async function cursorNow(user: TestUserSession, bookId: number): Promise<string> {
    let cursor = '0';
    for (;;) {
      const next = await page(user, bookId, `?since=${cursor}`);
      cursor = next.cursor;
      if (!next.hasMore) return cursor;
    }
  }

  const edit = (overrides: Record<string, unknown> = {}) => ({
    kind: 'merge',
    data: { from: 'Strider', into: 'Aragorn' },
    position: 0.25,
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...overrides,
  });

  it('advertises the feature on app-info', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/app-info', headers: authHeader(owner.accessToken) });
    expect(response.statusCode).toBe(200);
    const features = (response.json() as { features: string[] }).features;
    expect(features).toEqual([...SERVER_FEATURES]);
    expect(features).toContain('story-edits');
  });

  it('stores a correction as given and pages it back after the cursor', async () => {
    const before = await cursorNow(owner, bookA.bookId);
    const id = randomUUID();
    const data = { names: ['Strider', 'Aragorn'], nested: { anyKey: [1, null, true, { 'with space': '名' }] } };

    const response = await put(owner, bookA.bookId, id.toUpperCase(), edit({ data, position: 0.123456789012345 }));

    expect(response.statusCode).toBe(200);
    const stored = response.json() as StoryEdit;
    expect(stored).toEqual({ id, kind: 'merge', data, position: 0.123456789012345, updatedAt: '2026-11-06T10:00:00.000Z', deleted: false });

    const after = await page(owner, bookA.bookId, `?since=${before}`);
    expect(after.edits).toEqual([stored]);
    expect(Number(after.cursor)).toBeGreaterThan(Number(before));
    expect(after.hasMore).toBe(false);

    const unchanged = await page(owner, bookA.bookId, `?since=${after.cursor}`);
    expect(unchanged).toEqual({ edits: [], cursor: after.cursor, hasMore: false });
  });

  it('keeps the later write by client time, in either arrival order', async () => {
    const id = randomUUID();
    expect(
      (await put(owner, bookA.bookId, id, edit({ kind: 'rename', data: { name: 'Elessar' }, updatedAt: '2026-11-06T12:00:00.000Z' }))).statusCode,
    ).toBe(200);
    const cursor = await cursorNow(owner, bookA.bookId);

    const stale = await put(owner, bookA.bookId, id, edit({ kind: 'rename', data: { name: 'Strider' }, updatedAt: '2026-11-06T11:59:59.999Z' }));
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ data: { name: 'Elessar' }, updatedAt: '2026-11-06T12:00:00.000Z' });
    expect((await page(owner, bookA.bookId, `?since=${cursor}`)).edits).toEqual([]);

    const fresh = await put(
      owner,
      bookA.bookId,
      id,
      edit({ kind: 'rename', data: { name: 'Aragorn' }, position: null, updatedAt: '2026-11-06T12:00:00.001Z' }),
    );
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json()).toMatchObject({ data: { name: 'Aragorn' }, position: null, updatedAt: '2026-11-06T12:00:00.001Z' });
    expect((await page(owner, bookA.bookId, `?since=${cursor}`)).edits).toEqual([fresh.json()]);
  });

  it('keeps a delete as a tombstone that later pages carry', async () => {
    const id = randomUUID();
    expect((await put(owner, bookA.bookId, id, edit({ kind: 'hide', data: { name: 'Bill Ferny' } }))).statusCode).toBe(200);
    const cursor = await cursorNow(owner, bookA.bookId);

    const deleted = await put(
      owner,
      bookA.bookId,
      id,
      edit({ kind: 'hide', data: { name: 'Bill Ferny' }, updatedAt: '2026-11-06T10:05:00.000Z', deleted: true }),
    );

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ id, deleted: true });
    expect((await page(owner, bookA.bookId, `?since=${cursor}`)).edits).toEqual([deleted.json()]);
    const [row] = await ctx.db
      .select({ deleted: schema.storyEdits.deleted })
      .from(schema.storyEdits)
      .where(and(eq(schema.storyEdits.userId, owner.userId), eq(schema.storyEdits.id, id)));
    expect(row).toEqual({ deleted: true });
  });

  it('pages in revision order and reports more until the last page', async () => {
    const reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, libraryId, 'viewer');
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (const id of ids) expect((await put(reader, bookB.bookId, id, edit())).statusCode).toBe(200);

    const first = await page(reader, bookB.bookId, '?limit=2');
    const second = await page(reader, bookB.bookId, `?since=${first.cursor}&limit=2`);
    const third = await page(reader, bookB.bookId, `?since=${second.cursor}&limit=2`);

    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
    expect([...first.edits, ...second.edits, ...third.edits].map((item) => item.id)).toEqual(ids);
    expect((await page(reader, bookB.bookId, '?since=')).edits.map((item) => item.id)).toEqual(ids);
  });

  it('draws a distinct, increasing revision for every concurrent write, and the latest client time wins one id', async () => {
    const reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, libraryId, 'viewer');
    const shared = randomUUID();
    const distinct = Array.from({ length: 12 }, () => randomUUID());
    const times = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2026, 10, 6, 10, 0, index)).toISOString());

    const responses = await Promise.all([
      ...distinct.map((id) => put(reader, bookA.bookId, id, edit())),
      ...[...times].reverse().map((updatedAt, index) => put(reader, bookA.bookId, shared, edit({ kind: 'note', data: { n: index }, updatedAt }))),
    ]);
    expect(responses.map((response) => response.statusCode).every((status) => status === 200)).toBe(true);

    const rows = await ctx.db
      .select({ id: schema.storyEdits.id, revision: schema.storyEdits.revision, clientUpdatedAt: schema.storyEdits.clientUpdatedAt })
      .from(schema.storyEdits)
      .where(eq(schema.storyEdits.userId, reader.userId));
    expect(new Set(rows.map((row) => row.revision)).size).toBe(rows.length);
    expect(rows.find((row) => row.id === shared)?.clientUpdatedAt.toISOString()).toBe(times.at(-1));

    const listed = await page(reader, bookA.bookId);
    expect(listed.edits.map((item) => item.id).sort()).toEqual([...distinct, shared].sort());
    expect(listed.edits.find((item) => item.id === shared)?.updatedAt).toBe(times.at(-1));
  });

  it("keeps one reader's corrections from another reader of the same book", async () => {
    const id = randomUUID();
    expect((await put(owner, bookA.bookId, id, edit({ kind: 'note', data: { text: 'mine' } }))).statusCode).toBe(200);

    expect((await page(peer, bookA.bookId)).edits.map((item) => item.id)).not.toContain(id);

    const peerWrite = await put(peer, bookA.bookId, id, edit({ kind: 'note', data: { text: 'theirs' }, updatedAt: '2030-01-01T00:00:00.000Z' }));
    expect(peerWrite.statusCode).toBe(200);
    const ownerView = (await page(owner, bookA.bookId)).edits.find((item) => item.id === id);
    expect(ownerView?.data).toEqual({ text: 'mine' });
  });

  it('answers 404 for a book the reader cannot see, and for one that does not exist', async () => {
    expect((await get(outsider, bookA.bookId)).statusCode).toBe(404);
    expect((await put(outsider, bookA.bookId, randomUUID(), edit())).statusCode).toBe(404);
    expect((await get(owner, 2_000_000_000)).statusCode).toBe(404);
    const rows = await ctx.db.select().from(schema.storyEdits).where(eq(schema.storyEdits.userId, outsider.userId));
    expect(rows).toEqual([]);
  });

  it('refuses unknown fields and malformed values with 400', async () => {
    expect((await put(owner, bookA.bookId, randomUUID(), { ...edit(), revision: 4 })).statusCode).toBe(400);
    expect((await put(owner, bookA.bookId, randomUUID(), edit({ data: ['x'] }))).statusCode).toBe(400);
    expect((await put(owner, bookA.bookId, randomUUID(), edit({ position: 2 }))).statusCode).toBe(400);
    expect((await put(owner, bookA.bookId, 'not-a-uuid', edit())).statusCode).toBe(400);
    expect((await get(owner, bookA.bookId, '?since=x')).statusCode).toBe(400);
    expect((await get(owner, bookA.bookId, '?limit=201')).statusCode).toBe(400);
  });

  it('refuses a new live correction past the per-book cap, but still takes updates and tombstones', async () => {
    const reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, libraryId, 'viewer');
    const seeded = Array.from({ length: STORY_EDITS_PER_BOOK_MAX }, () => ({
      userId: reader.userId,
      bookId: bookB.bookId,
      id: randomUUID(),
      kind: 'note',
      data: {},
      clientUpdatedAt: new Date('2026-11-06T09:00:00.000Z'),
    }));
    for (let start = 0; start < seeded.length; start += 500) await ctx.db.insert(schema.storyEdits).values(seeded.slice(start, start + 500));

    const refused = await put(reader, bookB.bookId, randomUUID(), edit());
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ errorCode: 'STORY_EDITS_LIMIT_REACHED', errorMeta: { limit: STORY_EDITS_PER_BOOK_MAX } });

    expect((await put(reader, bookB.bookId, seeded[0]!.id, edit({ kind: 'rename' }))).statusCode).toBe(200);
    expect((await put(reader, bookB.bookId, randomUUID(), edit({ deleted: true }))).statusCode).toBe(200);
    expect((await put(reader, bookA.bookId, randomUUID(), edit())).statusCode).toBe(200);

    expect((await put(reader, bookB.bookId, seeded[1]!.id, edit({ deleted: true }))).statusCode).toBe(200);
    expect((await put(reader, bookB.bookId, randomUUID(), edit())).statusCode).toBe(200);
  });

  it("removes a reader's corrections with the reader, and a book's with the book", async () => {
    const leaving = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, leaving.userId, libraryId, 'viewer');
    expect((await put(leaving, bookA.bookId, randomUUID(), edit())).statusCode).toBe(200);
    await ctx.db.delete(schema.users).where(eq(schema.users.id, leaving.userId));
    expect(await ctx.db.select().from(schema.storyEdits).where(eq(schema.storyEdits.userId, leaving.userId))).toEqual([]);

    expect((await put(owner, bookB.bookId, randomUUID(), edit())).statusCode).toBe(200);
    await ctx.app.get(BookRepository).deleteByIdsAndInvalidateScanState([bookB.bookId]);
    expect(await ctx.db.select().from(schema.storyEdits).where(eq(schema.storyEdits.bookId, bookB.bookId))).toEqual([]);
  });
});
