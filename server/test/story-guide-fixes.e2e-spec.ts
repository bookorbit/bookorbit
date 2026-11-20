import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  Permission,
  STORY_GUIDE_FIXES_PER_TEXT_MAX,
  type AppInfoResponse,
  type StoryGuideFix,
  type StoryGuideFixesPage,
  type StoryGuidePayloadV1,
  type StoryGuideStatus,
  type StoryGuidesSummary,
} from '@bookorbit/types';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { FIXTURES_DIR } from '../src/modules/story-guides/testing/story-guide-fixtures';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type AuthorizationMatrixE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 120_000;
const UPDATED_AT = '2026-11-10T10:00:00.000Z';

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';

/** Fixes for everyone against PostgreSQL: storing, paging, applying, sharing by text, a Rebuild, deleting. */
describe('Story guide fixes (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let superuser!: TestUserSession;
  let manager!: TestUserSession;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;
  let book!: LocatedBookFile;
  let copy!: LocatedBookFile;
  let textKey = '';
  let fixture!: StoryGuidePayloadV1;
  const previousKey = process.env.AI_ENCRYPTION_KEY;

  const call = (session: TestUserSession | null, method: Method, url: string, payload?: object, headers: Record<string, string> = {}) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(session ? authHeader(session.accessToken) : {}), ...headers },
      ...(payload !== undefined ? { payload } : {}),
    });

  const fixesUrl = (file = book) => `/mobile/books/files/${file.bookFileId}/story-guide/fixes`;
  const contentUrl = (file = book) => `/mobile/books/files/${file.bookFileId}/story-guide?format=1`;

  const put = async (body: Record<string, unknown>, id = randomUUID(), session = manager, file = book) => {
    const response = await call(session, 'PUT', `${fixesUrl(file)}/${id}`, { updatedAt: UPDATED_AT, data: {}, ...body });
    return { id, response };
  };

  const page = async (since = '', session = manager, file = book): Promise<StoryGuideFixesPage> => {
    const response = await call(session, 'GET', `${fixesUrl(file)}${since ? `?since=${since}` : ''}`);
    expect(response.statusCode).toBe(200);
    return response.json<StoryGuideFixesPage>();
  };

  const content = async (session = reader, file = book) => {
    const response = await call(session, 'GET', contentUrl(file));
    expect(response.statusCode).toBe(200);
    return { body: response.json<StoryGuidePayloadV1>(), etag: response.headers.etag as string };
  };

  const status = async (session: TestUserSession, file = book): Promise<StoryGuideStatus> => {
    const response = await call(session, 'GET', `/books/${file.bookId}/story-guide`);
    expect(response.statusCode).toBe(200);
    return response.json<StoryGuideStatus>();
  };

  /** The key job runs in the background; status reports no key until it has. */
  const keyOf = async (file: LocatedBookFile): Promise<string> => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const current = await status(manager, file);
      if (current.textKey) return current.textKey;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The key job did not finish');
  };

  /** Stores a guide for the text, replacing any, as a finished build or Rebuild does. */
  const storeGuide = async (payload: StoryGuidePayloadV1) => {
    const gz = gzipSync(Buffer.from(JSON.stringify({ ...payload, textKey })));
    const values = {
      feature: 'story-guides',
      subjectKey: textKey,
      format: 1,
      pipeline: payload.pipeline,
      generation: 1,
      payload: gz,
      sha256: createHash('sha256').update(gz).digest('hex'),
      size: gz.length,
      coverage: 1,
    };
    await ctx.db
      .insert(schema.aiArtifacts)
      .values(values)
      .onConflictDoUpdate({ target: [schema.aiArtifacts.feature, schema.aiArtifacts.subjectKey], set: { ...values, builtAt: new Date() } });
  };

  const entity = (payload: StoryGuidePayloadV1, key: string) => payload.entities.find((candidate) => candidate.key === key);

  beforeAll(async () => {
    process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    ctx = await createAuthorizationMatrixE2EContext();
    await ctx.db.delete(schema.aiArtifacts);
    await ctx.db.delete(schema.aiJobs);
    await ctx.db.delete(schema.storyGuideFixes);
    await ctx.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} like 'ai.%'`);
    fixture = JSON.parse(await readFile(join(FIXTURES_DIR, 'story-guide-payload.json'), 'utf8')) as StoryGuidePayloadV1;

    const first = await createLibraryWithFolder(ctx, { name: `story-fixes-${randomUUID()}` });
    const second = await createLibraryWithFolder(ctx, { name: `story-fixes-copy-${randomUUID()}` });
    const firstPath = join(first.folderPath, 'a-study-in-scarlet.epub');
    const secondPath = join(second.folderPath, 'a-study-in-scarlet.epub');
    await copyFile(join(FIXTURES_DIR, 'a-study-in-scarlet.epub'), firstPath);
    await copyFile(join(FIXTURES_DIR, 'a-study-in-scarlet.epub'), secondPath);
    await triggerAndWaitForLibraryScan(ctx, first.libraryId);
    await triggerAndWaitForLibraryScan(ctx, second.libraryId);
    book = await locateBookByAbsolutePath(ctx, firstPath);
    copy = await locateBookByAbsolutePath(ctx, secondPath);

    superuser = await createUserAndLogin(ctx, { isSuperuser: true });
    manager = await createUserAndLogin(ctx, { permissions: [Permission.LibraryGenerateStoryGuide] });
    reader = await createUserAndLogin(ctx, { permissions: [] });
    outsider = await createUserAndLogin(ctx, { permissions: [Permission.LibraryGenerateStoryGuide] });
    for (const user of [manager, reader]) await grantLibraryAccess(ctx, user.userId, first.libraryId);
    await grantLibraryAccess(ctx, manager.userId, second.libraryId);

    textKey = await keyOf(book);
    expect(await keyOf(copy)).toBe(textKey);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });

  it('is advertised', async () => {
    expect((await call(reader, 'GET', '/app-info')).json<AppInfoResponse>().features).toContain('story-guide-fixes');
  });

  it('refuses readers, and answers 404 for a file the caller cannot see or that does not exist', async () => {
    const hide = { kind: 'hide', target: { key: 'tom', names: [] } };
    for (const response of [await call(reader, 'GET', fixesUrl()), (await put(hide, randomUUID(), reader)).response]) {
      expect(response.statusCode).toBe(403);
      expect(response.json<{ message: string }>().message).toBe('Missing permission: library_generate_story_guide');
    }
    expect((await call(outsider, 'GET', fixesUrl())).statusCode).toBe(404);
    expect((await put(hide, randomUUID(), outsider)).response.statusCode).toBe(404);
    expect((await call(manager, 'GET', '/mobile/books/files/999999999/story-guide/fixes')).statusCode).toBe(404);
    expect((await page()).fixes).toEqual([]);
  });

  it('stores a fix once per client id, the later updatedAt winning, and pages changes by cursor', async () => {
    const start = await page();
    const id = randomUUID();
    const body = { kind: 'rename', target: { key: 'tom-2', names: ['tom'] }, data: { name: 'The Dragon' } };
    const first = await put(body, id);
    expect(first.response.statusCode).toBe(200);
    const stored = first.response.json<StoryGuideFix>();
    expect(stored).toEqual({ id, ...body, from: null, updatedAt: UPDATED_AT, deleted: false });
    expect((await put(body, id)).response.json()).toEqual(stored);

    const older = await put({ ...body, data: { name: 'Older' }, updatedAt: '2026-11-09T10:00:00.000Z' }, id);
    expect(older.response.json()).toEqual(stored);

    const changes = await page(start.cursor);
    expect(changes.fixes).toEqual([stored]);
    expect(changes.hasMore).toBe(false);
    expect((await page(changes.cursor)).fixes).toEqual([]);

    const deleted = await put({ ...body, deleted: true, updatedAt: '2026-11-10T11:00:00.000Z' }, id);
    expect(deleted.response.json<StoryGuideFix>().deleted).toBe(true);
    expect((await page(changes.cursor)).fixes).toEqual([{ ...stored, deleted: true, updatedAt: '2026-11-10T11:00:00.000Z' }]);
    expect((await call(manager, 'GET', `${fixesUrl()}?since=${changes.cursor}&limit=0`)).statusCode).toBe(400);
  });

  it('serves readers the guide with fixes applied, under a tag each fix changes', async () => {
    await storeGuide(fixture);
    const before = await content();
    expect(before.body.fixesRevision).toBeGreaterThan(0);
    expect(entity(before.body, 'tom-2')?.name).toBe('TOM');

    await put({ kind: 'rename', target: { key: 'tom-2', names: ['tom'] }, data: { name: 'The Dragon' }, from: { s: 4, o: 0 } });
    await put({ kind: 'tie-hide', target: { key: 'tom|friend_of|tom-2', names: [] } });
    const after = await content();
    expect(after.etag).not.toBe(before.etag);
    expect(after.etag).toMatch(/^".+\.f1\.r\d+"$/);
    expect(entity(after.body, 'tom-2')).toMatchObject({ name: 'The Dragon', fixed: true });
    expect(entity(after.body, 'tom-2')?.names.at(-1)).toEqual({ text: 'The Dragon', at: { s: 4, o: 74, q: 'TOM' } });
    expect(after.body.ties.map((tie) => tie.key)).not.toContain('tom|friend_of|tom-2');
    expect(after.body.fixesRevision).toBeGreaterThan(before.body.fixesRevision);

    const again = await call(reader, 'GET', contentUrl(), undefined, { 'if-none-match': after.etag });
    expect(again.statusCode).toBe(304);
  });

  it('shares one set of fixes between every file with the same text', async () => {
    const fromCopy = await content(manager, copy);
    expect(entity(fromCopy.body, 'tom-2')?.name).toBe('The Dragon');
    const viaCopy = await put(
      { kind: 'line', target: { key: 'tom', names: ['tom'] }, data: { text: 'Keeps watch by night' }, from: { s: 4, o: 0 } },
      randomUUID(),
      manager,
      copy,
    );
    expect(viaCopy.response.statusCode).toBe(200);
    expect(entity((await content()).body, 'tom')?.lines).toEqual([{ through: { s: 3, end: true }, text: 'Keeps watch by night' }]);
    expect((await page('', manager, copy)).fixes.map((fix) => fix.id)).toEqual((await page()).fixes.map((fix) => fix.id));
  });

  it('keeps fixes across a Rebuild by key and by former names, and lists the orphans for managers', async () => {
    const byName = await put({
      kind: 'line',
      target: { key: 'violetta', names: ['violetta'] },
      data: { text: 'The heir', through: { s: 4, end: true } },
    });
    const orphan = await put({ kind: 'hide', target: { key: 'lord-leverance', names: ['lord-leverance'] } });
    const beforeRebuild = await page();
    expect(beforeRebuild.orphans).toEqual([]);
    expect(beforeRebuild.rematched).toEqual({});
    expect(entity((await content()).body, 'lord-leverance')).toBeUndefined();

    // The Rebuild names Violetta by her title and no longer finds Lord Leverance.
    const rebuilt = structuredClone(fixture);
    Object.assign(rebuilt.entities[0], { key: 'lady-violetta', name: 'Lady Violetta' });
    rebuilt.entities[0].names.push({ text: 'Lady Violetta', at: { s: 4, o: 30, q: 'Lady Violetta' } });
    rebuilt.entities.splice(1, 1);
    rebuilt.ties = rebuilt.ties.filter((tie) => !tie.key.includes('lord-leverance') && !tie.key.includes('violetta'));
    rebuilt.pipeline = 'x1.te1.na1.me1.re1.ti1.li1.as2';
    await storeGuide(rebuilt);

    const served = (await content()).body;
    expect(entity(served, 'lady-violetta')?.lines.at(-1)).toEqual({ through: { s: 4, end: true }, text: 'The heir' });
    expect(entity(served, 'tom-2')?.name).toBe('The Dragon');
    expect(entity(served, 'tom')?.lines.map((line) => line.text)).toEqual(['Keeps watch by night']);

    const listed = await page();
    expect(listed.orphans).toEqual([orphan.id]);
    expect(listed.rematched).toEqual({ [byName.id]: 'lady-violetta' });
    expect((await status(manager)).guide?.orphanedFixes).toBe(1);
    expect((await status(reader)).guide).not.toHaveProperty('orphanedFixes');

    // Apply again: the same fix pointed at a target the guide has.
    await put({ kind: 'hide', target: { key: 'tom', names: ['tom'] }, updatedAt: '2026-11-10T12:00:00.000Z' }, orphan.id);
    expect((await page()).orphans).toEqual([]);
    expect(entity((await content()).body, 'tom')).toBeUndefined();
    await put({ kind: 'hide', target: { key: 'tom', names: ['tom'] }, deleted: true, updatedAt: '2026-11-10T13:00:00.000Z' }, orphan.id);
  });

  it('keeps fixes when a guide is deleted, applies them to the next build, and deletes them when asked', async () => {
    const kept = await call(manager, 'DELETE', `/books/${book.bookId}/story-guide`);
    expect(kept.statusCode).toBe(200);
    expect(kept.json<StoryGuideStatus>().guide).toBeNull();
    const live = (await page()).fixes.filter((fix) => !fix.deleted);
    expect(live.length).toBeGreaterThan(0);
    expect((await page()).orphans).toEqual([]);

    await storeGuide(fixture);
    expect(entity((await content()).body, 'tom-2')?.name).toBe('The Dragon');

    const cursor = (await page()).cursor;
    const removed = await call(manager, 'DELETE', `/books/${book.bookId}/story-guide?fixes=delete`);
    expect(removed.statusCode).toBe(200);
    const tombstones = await page(cursor);
    expect(tombstones.fixes.map((fix) => fix.id).sort()).toEqual(live.map((fix) => fix.id).sort());
    expect(tombstones.fixes.every((fix) => fix.deleted)).toBe(true);
  });

  it('deletes every fix with every guide only when asked', async () => {
    await storeGuide(fixture);
    await put({ kind: 'hide', target: { key: 'tom', names: ['tom'] } });
    const summary = (await call(superuser, 'GET', '/admin/ai/features/story-guides')).json<StoryGuidesSummary>();
    expect(summary).toMatchObject({ count: 1, fixes: 1 });

    const keep = await call(superuser, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'keep', count: 1 });
    expect(keep.json()).toEqual({ deleted: 1, cancelled: 0 });
    expect((await call(superuser, 'GET', '/admin/ai/features/story-guides')).json()).toEqual({ count: 0, bytes: 0, fixes: 1 });

    await storeGuide(fixture);
    const stale = await call(superuser, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'delete', count: 2 });
    expect(stale.statusCode).toBe(409);
    expect((await call(superuser, 'GET', '/admin/ai/features/story-guides')).json<StoryGuidesSummary>().fixes).toBe(1);
    const all = await call(superuser, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'delete', count: 1 });
    expect(all.statusCode).toBe(200);
    expect((await call(superuser, 'GET', '/admin/ai/features/story-guides')).json()).toEqual({ count: 0, bytes: 0, fixes: 0 });
  });

  it('refuses a new fix past the per-text cap, but still takes a change to one it holds', async () => {
    const madeAt = new Date(UPDATED_AT);
    const rows = Array.from({ length: STORY_GUIDE_FIXES_PER_TEXT_MAX }, () => ({
      textKey,
      id: randomUUID(),
      kind: 'hide',
      target: { key: 'nobody', names: [] },
      data: {},
      clientUpdatedAt: madeAt,
      madeAt,
    }));
    for (let index = 0; index < rows.length; index += 500) await ctx.db.insert(schema.storyGuideFixes).values(rows.slice(index, index + 500));

    const refused = await put({ kind: 'hide', target: { key: 'tom', names: [] } });
    expect(refused.response.statusCode).toBe(409);
    expect(refused.response.json()).toMatchObject({
      errorCode: 'STORY_GUIDE_FIXES_LIMIT_REACHED',
      errorMeta: { limit: STORY_GUIDE_FIXES_PER_TEXT_MAX },
    });
    const changed = await put({ kind: 'hide', target: { key: 'tom', names: [] }, updatedAt: '2026-11-10T14:00:00.000Z' }, rows[0].id);
    expect(changed.response.statusCode).toBe(200);
    await ctx.db.delete(schema.storyGuideFixes).where(and(eq(schema.storyGuideFixes.textKey, textKey), eq(schema.storyGuideFixes.kind, 'hide')));
  });
});
