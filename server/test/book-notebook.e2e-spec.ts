import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { SERVER_FEATURES, type AnnotationItem, type BookJournalEntry } from '@bookorbit/types';

import * as schema from '../src/db/schema';
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

type InjectMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

describe('Book notebook (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let bookA!: LocatedBookFile;
  let bookB!: LocatedBookFile;
  let owner!: TestUserSession;
  let peer!: TestUserSession;
  let outsider!: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: `notebook-${randomUUID()}` });
    const pathA = await createEpubFixture(library.folderPath, 'notebook-a.epub', {
      title: `Notebook A ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    const pathB = await createEpubFixture(library.folderPath, 'notebook-b.epub', {
      title: `Notebook B ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
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

  function call(user: TestUserSession, method: InjectMethod, url: string, payload?: Record<string, unknown>) {
    return ctx.app.inject({ method, url: `/api/v1${url}`, headers: authHeader(user.accessToken), ...(payload !== undefined && { payload }) });
  }

  it('advertises the notebook capabilities on app-info', async () => {
    const response = await call(owner, 'GET', '/app-info');
    expect(response.statusCode).toBe(200);
    expect((response.json() as { features: string[] }).features).toEqual([...SERVER_FEATURES]);
  });

  describe('journal', () => {
    it('creates idempotently on the client id and lists oldest first', async () => {
      const clientId = randomUUID();
      const created = await call(owner, 'POST', `/books/${bookA.bookId}/journal`, {
        clientId,
        body: '  First thought  ',
        quote: 'A quoted line',
        chapterTitle: 'Chapter 1',
        positionPercent: 12.5,
        cfi: 'epubcfi(/6/8!/4/2/1:0)',
        createdAt: '2026-01-02T03:04:05.000Z',
      });
      expect(created.statusCode).toBe(201);
      const entry = created.json() as BookJournalEntry;
      expect(entry).toMatchObject({
        clientId,
        bookId: bookA.bookId,
        body: 'First thought',
        quote: 'A quoted line',
        chapterTitle: 'Chapter 1',
        positionPercent: 12.5,
        cfi: 'epubcfi(/6/8!/4/2/1:0)',
        positionSeconds: null,
        createdAt: '2026-01-02T03:04:05.000Z',
        deletedAt: null,
      });

      const replay = await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: clientId.toUpperCase(), body: 'Different body' });
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(entry);

      const later = await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: randomUUID(), body: 'Second thought' });
      expect(later.statusCode).toBe(201);

      const list = await call(owner, 'GET', `/books/${bookA.bookId}/journal`);
      expect(list.statusCode).toBe(200);
      const bodies = (list.json() as BookJournalEntry[]).map((item) => item.body);
      expect(bodies.indexOf('First thought')).toBeLessThan(bodies.indexOf('Second thought'));
      expect(bodies.filter((body) => body === 'First thought')).toHaveLength(1);
    });

    it('clamps a createdAt far in the future to the server clock', async () => {
      const before = Date.now();
      const response = await call(owner, 'POST', `/books/${bookA.bookId}/journal`, {
        clientId: randomUUID(),
        body: 'From a fast clock',
        createdAt: new Date(before + 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(response.statusCode).toBe(201);
      const createdAt = Date.parse((response.json() as BookJournalEntry).createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
      expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('answers 409 when a client id is reused on another book', async () => {
      const clientId = randomUUID();
      expect((await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId, body: 'On A' })).statusCode).toBe(201);

      const conflict = await call(owner, 'POST', `/books/${bookB.bookId}/journal`, { clientId, body: 'On B' });
      expect(conflict.statusCode).toBe(409);
    });

    it('rejects blank bodies, malformed ids and unknown fields with 400', async () => {
      expect((await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: randomUUID(), body: '   ' })).statusCode).toBe(400);
      expect((await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: 'nope', body: 'x' })).statusCode).toBe(400);
      expect((await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: randomUUID(), body: 'x', mood: 'calm' })).statusCode).toBe(400);
      expect(
        (await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId: randomUUID(), body: 'x', positionPercent: 101 })).statusCode,
      ).toBe(400);
      expect((await call(owner, 'PATCH', `/books/${bookA.bookId}/journal/not-a-uuid`, { body: 'x' })).statusCode).toBe(400);
      expect((await call(owner, 'GET', `/books/${bookA.bookId}/journal?status=everything`)).statusCode).toBe(400);
    });

    it('edits, trashes, restores and permanently deletes through the trash only', async () => {
      const clientId = randomUUID();
      const base = `/books/${bookA.bookId}/journal/${clientId}`;
      await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId, body: 'Lifecycle', quote: 'Quote to clear' });

      const edited = await call(owner, 'PATCH', base, { body: 'Lifecycle edited', quote: null, positionSeconds: 30 });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({ body: 'Lifecycle edited', quote: null, positionSeconds: 30 });
      expect((await call(owner, 'PATCH', base, { body: null })).statusCode).toBe(400);

      expect((await call(owner, 'DELETE', `${base}/permanent`)).statusCode).toBe(404);
      expect((await call(owner, 'DELETE', base)).statusCode).toBe(204);
      expect((await call(owner, 'DELETE', base)).statusCode).toBe(204);
      expect((await call(owner, 'PATCH', base, { body: 'Edit in trash' })).statusCode).toBe(404);

      const active = (await call(owner, 'GET', `/books/${bookA.bookId}/journal`)).json() as BookJournalEntry[];
      expect(active.some((item) => item.clientId === clientId)).toBe(false);
      const trashed = (await call(owner, 'GET', `/books/${bookA.bookId}/journal?status=trashed`)).json() as BookJournalEntry[];
      const inTrash = trashed.find((item) => item.clientId === clientId);
      expect(inTrash?.deletedAt).toEqual(expect.any(String));

      const restored = await call(owner, 'POST', `${base}/restore`);
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ clientId, deletedAt: null, body: 'Lifecycle edited' });
      expect((await call(owner, 'POST', `${base}/restore`)).statusCode).toBe(404);

      expect((await call(owner, 'DELETE', base)).statusCode).toBe(204);
      expect((await call(owner, 'DELETE', `${base}/permanent`)).statusCode).toBe(204);
      expect((await call(owner, 'DELETE', `${base}/permanent`)).statusCode).toBe(404);
      expect((await call(owner, 'DELETE', base)).statusCode).toBe(404);
      const [row] = await ctx.db.select().from(schema.bookJournalEntries).where(eq(schema.bookJournalEntries.clientId, clientId));
      expect(row).toBeUndefined();
    });

    it('keeps every entry private to its author and the book behind library access', async () => {
      const clientId = randomUUID();
      await call(owner, 'POST', `/books/${bookA.bookId}/journal`, { clientId, body: 'Private' });

      const peerList = (await call(peer, 'GET', `/books/${bookA.bookId}/journal`)).json() as BookJournalEntry[];
      expect(peerList.some((item) => item.clientId === clientId)).toBe(false);
      expect((await call(peer, 'PATCH', `/books/${bookA.bookId}/journal/${clientId}`, { body: 'Hijack' })).statusCode).toBe(404);
      expect((await call(peer, 'DELETE', `/books/${bookA.bookId}/journal/${clientId}`)).statusCode).toBe(404);

      const peerOwn = await call(peer, 'POST', `/books/${bookA.bookId}/journal`, { clientId, body: 'Same id, different reader' });
      expect(peerOwn.statusCode).toBe(201);
      expect((peerOwn.json() as BookJournalEntry).body).toBe('Same id, different reader');

      expect((await call(outsider, 'GET', `/books/${bookA.bookId}/journal`)).statusCode).toBe(404);
      expect((await call(outsider, 'POST', `/books/${bookA.bookId}/journal`, { clientId: randomUUID(), body: 'x' })).statusCode).toBe(404);
    });
  });

  describe('annotations', () => {
    async function createAnnotation(cfi: string, note: string | null = null): Promise<number> {
      const response = await call(owner, 'POST', `/books/${bookB.bookId}/annotations`, { cfi, text: `text at ${cfi}`, color: '#FACC15', note });
      expect(response.statusCode).toBe(201);
      return (response.json() as { id: number }).id;
    }

    async function storedVersion(id: number) {
      const [row] = await ctx.db
        .select({ version: schema.annotations.version, starredAt: schema.annotations.starredAt })
        .from(schema.annotations)
        .where(eq(schema.annotations.id, id));
      return row;
    }

    let tenId: number;
    let eightId: number;
    let eightLaterId: number;

    beforeAll(async () => {
      tenId = await createAnnotation('epubcfi(/6/10!/4/2/1:0)', 'remove me');
      eightLaterId = await createAnnotation('epubcfi(/6/8!/4/2/1:12)');
      eightId = await createAnnotation('epubcfi(/6/8!/4/2/1:9)');
    });

    it('sorts by reading position numerically, so /6/8 comes before /6/10', async () => {
      const response = await call(owner, 'GET', `/books/${bookB.bookId}/annotations?page=1&pageSize=25&sortBy=position&sortDir=asc`);
      expect(response.statusCode).toBe(200);
      const ids = (response.json() as { items: AnnotationItem[] }).items.map((item) => item.id);
      expect(ids).toEqual([eightId, eightLaterId, tenId]);
    });

    it('exports a book in reading order', async () => {
      const response = await call(owner, 'GET', `/annotations/export?format=json&bookId=${bookB.bookId}`);
      expect(response.statusCode).toBe(200);
      const ids = (JSON.parse(response.body) as { id: number }[]).map((row) => row.id);
      expect(ids).toEqual([eightId, eightLaterId, tenId]);
    });

    it('stars and unstars without bumping the version devices sync from', async () => {
      const before = await storedVersion(eightId);

      const starred = await call(owner, 'PATCH', `/books/${bookB.bookId}/annotations/${eightId}`, { starred: true });
      expect(starred.statusCode).toBe(200);
      const starredAt = (starred.json() as AnnotationItem).starredAt;
      expect(starredAt).toEqual(expect.any(String));
      expect((await storedVersion(eightId)).version).toBe(before.version);

      const again = await call(owner, 'PATCH', `/books/${bookB.bookId}/annotations/${eightId}`, { starred: true });
      expect((again.json() as AnnotationItem).starredAt).toBe(starredAt);

      const list = (await call(owner, 'GET', `/books/${bookB.bookId}/annotations`)).json() as AnnotationItem[];
      expect(list.find((item) => item.id === eightId)?.starredAt).toBe(starredAt);
      expect(list.find((item) => item.id === tenId)?.starredAt).toBeNull();

      const unstarred = await call(owner, 'PATCH', `/books/${bookB.bookId}/annotations/${eightId}`, { starred: false });
      expect((unstarred.json() as AnnotationItem).starredAt).toBeNull();
      expect((await storedVersion(eightId)).version).toBe(before.version);

      expect((await call(owner, 'PATCH', `/books/${bookB.bookId}/annotations/${eightId}`, { starred: null })).statusCode).toBe(400);
    });

    it('clears a note with null and bumps the version for that content change', async () => {
      const before = await storedVersion(tenId);

      const response = await call(owner, 'PATCH', `/books/${bookB.bookId}/annotations/${tenId}`, { note: null });

      expect(response.statusCode).toBe(200);
      expect((response.json() as AnnotationItem).note).toBeNull();
      expect((await storedVersion(tenId)).version).toBe(before.version + 1);
    });

    it('bulk stars active rows only and reports what changed', async () => {
      const trashedId = await createAnnotation('epubcfi(/6/12!/4/2/1:0)');
      expect((await call(owner, 'DELETE', `/books/${bookB.bookId}/annotations/${trashedId}`)).statusCode).toBe(204);
      const versionBefore = (await storedVersion(eightLaterId)).version;

      const star = await call(owner, 'POST', '/annotations/bulk', { ids: [eightLaterId, tenId, trashedId], action: 'star' });
      expect(star.statusCode).toBe(200);
      expect(star.json()).toEqual({ affected: 2 });
      expect((await storedVersion(trashedId)).starredAt).toBeNull();
      expect((await storedVersion(eightLaterId)).version).toBe(versionBefore);

      const hub = (await call(owner, 'GET', `/annotations?bookId=${bookB.bookId}`)).json() as { items: AnnotationItem[] };
      expect(hub.items.find((item) => item.id === tenId)?.starredAt).toEqual(expect.any(String));

      const peerStar = await call(peer, 'POST', '/annotations/bulk', { ids: [eightId], action: 'star' });
      expect(peerStar.json()).toEqual({ affected: 0 });

      const unstar = await call(owner, 'POST', '/annotations/bulk', { ids: [eightLaterId, tenId, eightId], action: 'unstar' });
      expect(unstar.json()).toEqual({ affected: 2 });
    });
  });

  describe('bookmarks', () => {
    it('renames and annotates a bookmark, and reports the new fields', async () => {
      const created = await call(owner, 'POST', `/books/${bookA.bookId}/bookmarks`, { cfi: 'epubcfi(/6/14!/4/2/1:0)', title: 'Chapter 7' });
      expect(created.statusCode).toBe(201);
      const bookmark = created.json() as {
        id: number;
        note: string | null;
        updatedAt: string;
        clientId: string;
        origin: string;
        chapterId: string | null;
      };
      expect(bookmark).toMatchObject({ note: null, origin: 'web', chapterId: null, clientId: expect.any(String), updatedAt: expect.any(String) });

      const edited = await call(owner, 'PATCH', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`, { title: '  The duel  ', note: 'Reread this' });
      expect(edited.statusCode).toBe(200);
      const after = edited.json() as typeof bookmark & { title: string };
      expect(after).toMatchObject({ id: bookmark.id, title: 'The duel', note: 'Reread this', clientId: bookmark.clientId });
      expect(Date.parse(after.updatedAt)).toBeGreaterThanOrEqual(Date.parse(bookmark.updatedAt));

      const cleared = await call(owner, 'PATCH', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`, { note: '  ' });
      expect(cleared.json()).toMatchObject({ title: 'The duel', note: null });

      const list = (await call(owner, 'GET', `/books/${bookA.bookId}/bookmarks`)).json() as { id: number; title: string; note: string | null }[];
      expect(list.find((item) => item.id === bookmark.id)).toMatchObject({ title: 'The duel', note: null });

      expect((await call(owner, 'PATCH', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`, { title: '' })).statusCode).toBe(400);
      expect((await call(peer, 'PATCH', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`, { title: 'Hijack' })).statusCode).toBe(404);
      expect((await call(owner, 'DELETE', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`)).statusCode).toBe(204);
      expect((await call(owner, 'PATCH', `/books/${bookA.bookId}/bookmarks/${bookmark.id}`, { title: 'Gone' })).statusCode).toBe(404);
    });
  });

  describe('annotation colour names', () => {
    it('defaults to none, stores normalised names and rejects invalid ones', async () => {
      const initial = await call(owner, 'GET', '/user-preferences/annotation-colors');
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toEqual({ settings: { names: {} } });

      const saved = await call(owner, 'PUT', '/user-preferences/annotation-colors', { settings: { names: { '#facc15': ' Ideas ', '#4ADE80': '' } } });
      expect(saved.statusCode).toBe(204);
      expect((await call(owner, 'GET', '/user-preferences/annotation-colors')).json()).toEqual({ settings: { names: { '#FACC15': 'Ideas' } } });
      expect((await call(peer, 'GET', '/user-preferences/annotation-colors')).json()).toEqual({ settings: { names: {} } });

      expect((await call(owner, 'PUT', '/user-preferences/annotation-colors', { settings: { names: { yellow: 'Ideas' } } })).statusCode).toBe(400);
      const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`#${i.toString(16).padStart(6, '0')}`, `Name ${i}`]));
      expect((await call(owner, 'PUT', '/user-preferences/annotation-colors', { settings: { names: tooMany } })).statusCode).toBe(400);
      expect((await call(owner, 'GET', '/user-preferences/annotation-colors')).json()).toEqual({ settings: { names: { '#FACC15': 'Ideas' } } });
    });
  });
});
