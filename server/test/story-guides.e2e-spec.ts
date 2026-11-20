import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Permission,
  type AiJobActionResponse,
  type AiJobList,
  type AppInfoResponse,
  type StoryGuideHistory,
  type StoryGuideList,
  type StoryGuideSpeeds,
  type StoryGuideStatus,
} from '@bookorbit/types';
import { and, eq, like, sql } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { AiStepRates } from '../src/modules/ai-jobs/ai-step-rates.service';
import { AI_STEP_TIMINGS_KEPT } from '../src/modules/ai-jobs/ai-step-timing.repository';
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
import { createEpubFixture } from './e2e/authorization-matrix/authorization-matrix-fixture-builder';

const SCENARIO_TIMEOUT_MS = 120_000;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A stored artifact's payload columns: gzipped JSON, its hash and size. */
function storedPayload() {
  const payload = gzipSync(Buffer.from('{}'));
  return { payload, sha256: createHash('sha256').update(payload).digest('hex'), size: payload.length };
}

/** Story guide status and building against PostgreSQL, per role and state. */
describe('Story guides (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let superuser!: TestUserSession;
  let settingsAdmin!: TestUserSession;
  let builder!: TestUserSession;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;
  let book!: LocatedBookFile;
  let shortBook!: LocatedBookFile;
  let libraryId = 0;
  const previousKey = process.env.AI_ENCRYPTION_KEY;

  const call = (session: TestUserSession | null, method: Method, url: string, payload?: object, headers: Record<string, string> = {}) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(session ? authHeader(session.accessToken) : {}), ...headers },
      ...(payload !== undefined ? { payload } : {}),
    });

  const status = async (session: TestUserSession, bookId = book.bookId, query = ''): Promise<StoryGuideStatus> => {
    const response = await call(session, 'GET', `/books/${bookId}/story-guide${query}`);
    expect(response.statusCode).toBe(200);
    return response.json<StoryGuideStatus>();
  };

  /** The key job runs in the background; status reports `checking` until it has. */
  const statusOnceRead = async (session: TestUserSession, bookId = book.bookId): Promise<StoryGuideStatus> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await status(session, bookId);
      if (current.textKey || (current.build.allowed === false && current.build.reason && current.build.reason !== 'checking')) return current;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The key job did not finish');
  };

  const setFeature = async (enabled: boolean) => {
    const response = await call(superuser, 'PUT', '/admin/ai/settings/features/story-guides', { enabled, confirmPrivacy: true });
    expect(response.statusCode).toBe(200);
  };

  beforeAll(async () => {
    process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    ctx = await createAuthorizationMatrixE2EContext();
    await ctx.db.delete(schema.aiArtifacts);
    await ctx.db.delete(schema.aiJobs);
    await ctx.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} like 'ai.%'`);

    const library = await createLibraryWithFolder(ctx, { name: `story-guides-${randomUUID()}` });
    libraryId = library.libraryId;
    const guidePath = join(library.folderPath, 'a-study-in-scarlet.epub');
    await copyFile(join(FIXTURES_DIR, 'a-study-in-scarlet.epub'), guidePath);
    const shortPath = await createEpubFixture(library.folderPath, 'short.epub', { title: 'A Short Book' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, guidePath);
    shortBook = await locateBookByAbsolutePath(ctx, shortPath);

    superuser = await createUserAndLogin(ctx, { isSuperuser: true });
    settingsAdmin = await createUserAndLogin(ctx, { permissions: [Permission.ManageAppSettings, Permission.LibraryGenerateStoryGuide] });
    builder = await createUserAndLogin(ctx, { permissions: [Permission.LibraryGenerateStoryGuide] });
    reader = await createUserAndLogin(ctx, { permissions: [] });
    outsider = await createUserAndLogin(ctx, { permissions: [Permission.LibraryGenerateStoryGuide] });
    for (const user of [settingsAdmin, builder, reader]) await grantLibraryAccess(ctx, user.userId, libraryId);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });

  it('answers 404 for a book the caller cannot see, on every route', async () => {
    const routes: Array<[Method, string, object?]> = [
      ['GET', `/books/${book.bookId}/story-guide`],
      ['POST', `/books/${book.bookId}/story-guide`, { kind: 'build' }],
      ['POST', `/books/${book.bookId}/story-guide/retry`, {}],
      ['POST', `/books/${book.bookId}/story-guide/cancel`, {}],
      ['DELETE', `/books/${book.bookId}/story-guide`],
      ['GET', `/books/999999999/story-guide`],
    ];
    for (const [method, url, payload] of routes) {
      const response = await call(outsider, method, url, payload);
      expect({ url, method, status: response.statusCode }).toEqual({ url, method, status: 404 });
    }
  });

  it('refuses building without the permission, and a file of another book', async () => {
    for (const [method, url, payload] of [
      ['POST', `/books/${book.bookId}/story-guide`, { kind: 'build' }],
      ['POST', `/books/${book.bookId}/story-guide/retry`, {}],
      ['POST', `/books/${book.bookId}/story-guide/cancel`, {}],
      ['DELETE', `/books/${book.bookId}/story-guide`, undefined],
    ] as Array<[Method, string, object | undefined]>) {
      expect((await call(reader, method, url, payload)).statusCode).toBe(403);
    }
    expect((await call(builder, 'GET', `/books/${book.bookId}/story-guide?fileId=${shortBook.bookFileId}`)).statusCode).toBe(404);
    expect((await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind: 'build', extra: true })).statusCode).toBe(400);
    expect((await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind: 'refresh' })).statusCode).toBe(400);
  });

  it('reports the feature off to managers, and nothing to readers', async () => {
    const managed = await status(builder);
    expect(managed.fileId).toBe(book.bookFileId);
    expect(managed.canManage).toBe(true);
    expect(managed.build).toEqual({ allowed: false, reason: 'off' });
    expect(managed.guide).toBeNull();
    expect(managed.job).toBeNull();

    const read = await status(reader);
    expect(read).toEqual({ fileId: book.bookFileId, textKey: read.textKey, canManage: false, build: { allowed: false }, guide: null, job: null });
  });

  it('reports checking until the key job has read the file, then the build allowed', async () => {
    await setFeature(true);
    const first = await status(builder, shortBook.bookId);
    if (!first.textKey) expect(first.build).toEqual({ allowed: false, reason: 'checking' });

    const ready = await statusOnceRead(builder);
    expect(ready.textKey).toMatch(/^[0-9a-f]{64}$/);
    expect(ready.build).toEqual({ allowed: true });
    // No build has finished on the slot models, so there is no time to give yet.
    expect(ready.estimate).toEqual({ words: expect.any(Number), minutes: null });
    expect(ready.estimate?.words).toBeGreaterThan(40_000);

    const short = await statusOnceRead(builder, shortBook.bookId);
    expect(short.build).toEqual({ allowed: false, reason: 'too-short' });
    expect(short.estimate).toBeUndefined();
  });

  it('sends dollars only to callers who manage app settings', async () => {
    const admin = await statusOnceRead(settingsAdmin);
    expect(admin.estimate).toHaveProperty('cost');
    expect(admin.estimate?.cost).toBeNull();
    expect((await statusOnceRead(superuser)).estimate).toHaveProperty('cost');
    expect((await statusOnceRead(builder)).estimate).not.toHaveProperty('cost');
  });

  it('answers 304 when the status is unchanged', async () => {
    const first = await call(builder, 'GET', `/books/${book.bookId}/story-guide`);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^".+"$/);
    const again = await call(builder, 'GET', `/books/${book.bookId}/story-guide`, undefined, { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    // Each role's view is its own body, so its own tag.
    const asReader = await call(reader, 'GET', `/books/${book.bookId}/story-guide`, undefined, { 'if-none-match': etag });
    expect(asReader.statusCode).toBe(200);
  });

  it('queues a build, refuses a second while it is unfinished, and shows readers only its state', async () => {
    const queued = await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind: 'build' });
    expect(queued.statusCode).toBe(202);
    const body = queued.json<StoryGuideStatus>();
    expect(body.job).toMatchObject({ kind: 'build' });
    expect(['queued', 'running', 'paused']).toContain(body.job?.state);

    const second = await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind: 'build' });
    expect(second.statusCode).toBe(409);
    expect(second.json<StoryGuideStatus>().job).toMatchObject({ kind: 'build' });

    const read = await status(reader);
    expect(Object.keys(read.job ?? {}).sort()).toEqual(['kind', 'phase', 'state']);
    expect(read.estimate).toBeUndefined();

    const update = await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind: 'rebuild' });
    expect(update.statusCode).toBe(409);
  });

  it('lists the job in the AI area to its requester and settings managers, and to nobody else', async () => {
    const own = await call(builder, 'GET', '/ai/jobs');
    expect(own.statusCode).toBe(200);
    const list = own.json<AiJobList>();
    expect(list.counts.queue).toBe(1);
    expect(list.items).toHaveLength(1);
    const [job] = list.items;
    expect(job).toMatchObject({
      feature: 'story-guides',
      kind: 'build',
      subject: { url: `/book/${book.bookId}` },
      requester: { id: builder.userId },
      cost: null,
    });
    expect(job!.actions).toContain('cancel');
    expect(job!.actions).not.toContain('prioritize');

    expect((await call(builder, 'GET', '/ai/jobs?scope=all')).statusCode).toBe(403);
    expect((await call(reader, 'GET', '/ai/jobs')).statusCode).toBe(403);
    expect((await call(null, 'GET', '/ai/jobs')).statusCode).toBe(401);
    expect((await call(outsider, 'GET', '/ai/jobs')).json<AiJobList>().items).toEqual([]);

    const all = (await call(settingsAdmin, 'GET', '/ai/jobs?scope=all&view=queue&limit=10')).json<AiJobList>();
    expect(all.items.map((item) => item.id)).toEqual([job!.id]);
    expect(all.items[0]!.requester).toMatchObject({ id: builder.userId });

    const foreign = await call(outsider, 'POST', '/ai/jobs/actions', { action: 'cancel', ids: [job!.id] });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json<AiJobActionResponse>().results).toEqual([{ id: job!.id, outcome: 'not-found', status: null, reason: null }]);
    expect(
      (await call(builder, 'POST', '/ai/jobs/actions', { action: 'prioritize', ids: [job!.id] })).json<AiJobActionResponse>().results[0]!.outcome,
    ).not.toBe('done');

    for (const [method, url, payload] of [
      ['GET', '/ai/jobs?limit=101'],
      ['GET', '/ai/jobs?view=later'],
      ['POST', '/ai/jobs/actions', { action: 'cancel', ids: [] }],
      ['POST', '/ai/jobs/actions', { action: 'explode', ids: [job!.id] }],
      ['POST', '/ai/jobs/actions', { action: 'cancel', ids: ['not-a-uuid'] }],
      ['POST', '/ai/jobs/actions', { action: 'cancel', ids: [job!.id], extra: true }],
    ] as Array<[Method, string, object?]>) {
      expect((await call(builder, method, url, payload)).statusCode).toBe(400);
    }
    expect((await status(builder)).job).not.toBeNull();
  });

  it('cancels the job, and refuses an update or rebuild without a guide', async () => {
    const cancelled = await call(builder, 'POST', `/books/${book.bookId}/story-guide/cancel`, {});
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<StoryGuideStatus>().job).toBeNull();
    for (const kind of ['update', 'rebuild']) {
      const refused = await call(builder, 'POST', `/books/${book.bookId}/story-guide`, { kind });
      expect(refused.statusCode).toBe(409);
      expect(refused.json<StoryGuideStatus>().job).toBeNull();
    }
  });

  it('serves a stored guide to readers without its models, and deletes it', async () => {
    const { textKey } = await statusOnceRead(builder);
    await ctx.db.insert(schema.aiArtifacts).values({
      feature: 'story-guides',
      subjectKey: textKey!,
      format: 1,
      pipeline: 'x0.old',
      generation: 1,
      ...storedPayload(),
      coverage: 0.97,
      models: { fast: { connectionId: 1, model: 'fast-model' } },
    });

    const managed = await status(builder);
    expect(managed.guide).toMatchObject({ coverage: 0.97, format: 1, outdated: true, modelsChanged: false, models: expect.any(Object) });
    expect(managed.updateEstimate).toEqual({ minutes: null });
    const read = await status(reader);
    expect(read.guide).not.toHaveProperty('models');
    expect(read.guide?.outdated).toBe(true);

    const info = (await call(reader, 'GET', '/app-info')).json<AppInfoResponse>();
    expect(info.features).toContain('story-guides');
    expect(info.storyGuides).toEqual({ building: false, served: true });

    // Outside production the content route takes a request with no assertion.
    const contentUrl = `/mobile/books/files/${book.bookFileId}/story-guide`;
    const content = await call(reader, 'GET', `${contentUrl}?format=1`);
    expect(content.statusCode).toBe(200);
    expect(content.json()).toEqual({});
    const contentTag = content.headers.etag as string;
    expect(contentTag).toMatch(/^".+\.f1"$/);
    expect((await call(reader, 'GET', `${contentUrl}?format=1`, undefined, { 'if-none-match': contentTag })).statusCode).toBe(304);
    expect((await call(reader, 'GET', contentUrl)).headers.etag).toBe(contentTag);
    const newer = await call(reader, 'GET', `${contentUrl}?format=2`);
    expect(newer.statusCode).toBe(404);
    expect(newer.json()).toEqual({ reason: 'format' });
    expect((await call(reader, 'GET', `${contentUrl}?format=x`)).statusCode).toBe(400);
    expect((await call(outsider, 'GET', `${contentUrl}?format=1`)).statusCode).toBe(404);
    const none = await call(reader, 'GET', `/mobile/books/files/${shortBook.bookFileId}/story-guide?format=1`);
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ reason: 'none' });

    const removed = await call(builder, 'DELETE', `/books/${book.bookId}/story-guide?fixes=keep`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json<StoryGuideStatus>().guide).toBeNull();
    expect((await call(reader, 'GET', `${contentUrl}?format=1`)).json()).toEqual({ reason: 'none' });
    const rows = await ctx.db
      .select()
      .from(schema.aiArtifacts)
      .where(and(eq(schema.aiArtifacts.feature, 'story-guides'), eq(schema.aiArtifacts.subjectKey, textKey!)));
    expect(rows).toHaveLength(0);
  });

  it('deletes every guide only for app settings managers, and only at the count shown', async () => {
    const { textKey } = await statusOnceRead(builder);
    await ctx.db.insert(schema.aiArtifacts).values({
      feature: 'story-guides',
      subjectKey: textKey!,
      format: 1,
      pipeline: 'x0.old',
      generation: 1,
      ...storedPayload(),
      coverage: 1,
    });

    expect((await call(builder, 'GET', '/admin/ai/features/story-guides')).statusCode).toBe(403);
    expect((await call(builder, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'keep', count: 1 })).statusCode).toBe(403);
    expect((await call(settingsAdmin, 'GET', '/admin/ai/features/story-guides')).json()).toEqual({ count: 1, bytes: storedPayload().size, fixes: 0 });

    const stale = await call(settingsAdmin, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'keep', count: 3 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ count: 1 });
    expect((await call(settingsAdmin, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'keep' })).statusCode).toBe(400);

    const done = await call(settingsAdmin, 'POST', '/admin/ai/features/story-guides/delete-all', { fixes: 'delete', count: 1 });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ deleted: 1, cancelled: 0 });
    expect((await status(builder)).guide).toBeNull();
    expect((await call(reader, 'GET', '/app-info')).json<AppInfoResponse>().storyGuides).toEqual({ building: false, served: false });
  });

  it('lists stored guides with their book and build, and averages their builds, only for settings managers', async () => {
    const { textKey } = await statusOnceRead(builder);
    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - 200_000);
    const models = { fast: { connectionId: 1, model: 'fast-model' }, careful: { connectionId: 1, model: 'careful-model' } };
    const [job] = await ctx.db
      .insert(schema.aiJobs)
      .values({
        feature: 'story-guides',
        kind: 'rebuild',
        subjectKey: textKey!,
        subjectRef: {},
        pipeline: 'x0.old',
        status: 'completed',
        models,
        startedAt,
        finishedAt,
      })
      .returning();
    await ctx.db.insert(schema.aiArtifacts).values([
      {
        feature: 'story-guides',
        subjectKey: textKey!,
        format: 1,
        pipeline: 'x0.old',
        generation: 1,
        ...storedPayload(),
        coverage: 0.9,
        models,
        costMicros: 1_250_000,
        jobId: job!.id,
      },
      // No file has this text any more.
      { feature: 'story-guides', subjectKey: `gone-${randomUUID()}`, format: 1, pipeline: 'x0.old', generation: 1, ...storedPayload(), coverage: 1 },
    ]);
    // The scan may not have read a title from the fixture; the list sorts and searches by it.
    await ctx.db
      .insert(schema.bookMetadata)
      .values({ bookId: book.bookId, title: 'A Study in Scarlet' })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { title: 'A Study in Scarlet' } });
    const guides = (query = '') => call(settingsAdmin, 'GET', `/admin/ai/features/story-guides/guides${query}`);

    try {
      expect((await call(builder, 'GET', '/admin/ai/features/story-guides/guides')).statusCode).toBe(403);
      expect((await call(builder, 'GET', '/admin/ai/features/story-guides/history')).statusCode).toBe(403);

      const listed = await guides('?sort=title&direction=asc');
      expect(listed.statusCode).toBe(200);
      const { items, total } = listed.json<StoryGuideList>();
      expect(total).toBe(2);
      expect(items[0]).toMatchObject({
        key: textKey,
        bookId: book.bookId,
        fileId: book.bookFileId,
        title: 'A Study in Scarlet',
        kind: 'rebuild',
        seconds: 200,
        cost: 1.25,
        bytes: storedPayload().size,
        coverage: 0.9,
        models,
      });
      expect(items[0]!.image).toMatch(new RegExp(`^/api/v1/books/${book.bookId}/thumbnail`));
      expect(items[1]).toMatchObject({ bookId: null, fileId: null, title: null, byline: null, image: null, kind: null, seconds: null, cost: null });

      expect((await guides('?q=SCARLET')).json<StoryGuideList>()).toMatchObject({ total: 1, items: [{ key: textKey }] });
      expect((await guides('?sort=cost&direction=desc&limit=1&offset=1')).json<StoryGuideList>()).toMatchObject({
        total: 2,
        items: [{ bookId: null }],
      });
      expect((await guides('?sort=words')).statusCode).toBe(400);
      expect((await guides('?limit=101')).statusCode).toBe(400);
      expect((await guides(`?q=${'x'.repeat(201)}`)).statusCode).toBe(400);

      const history = await call(settingsAdmin, 'GET', '/admin/ai/features/story-guides/history');
      expect(history.statusCode).toBe(200);
      expect(history.json<StoryGuideHistory>()).toEqual({
        cost: 1.25,
        medianSeconds: 200,
        models: [
          { fast: 'fast-model', careful: 'careful-model', builds: 1, averageSeconds: 200, averageCost: 1.25 },
          { fast: null, careful: null, builds: 1, averageSeconds: null, averageCost: null },
        ],
      });
    } finally {
      await ctx.db.delete(schema.aiArtifacts).where(eq(schema.aiArtifacts.feature, 'story-guides'));
      await ctx.db.delete(schema.aiJobs).where(eq(schema.aiJobs.id, job!.id));
    }
  });

  it('times a build from the speed its models showed, and lets only settings managers read and reset that speed', async () => {
    const [connection] = await ctx.db
      .insert(schema.aiConnections)
      .values({ name: `speeds-${randomUUID().slice(0, 8)}`, apiType: 'openai', baseUrl: 'http://127.0.0.1:9' })
      .returning();
    const slots = { fast: { connectionId: connection!.id, model: 'fast-e2e' }, careful: { connectionId: connection!.id, model: 'careful-e2e' } };
    await ctx.db
      .insert(schema.appSettings)
      .values({ key: 'ai.slots', value: JSON.stringify(slots) })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: JSON.stringify(slots) } });
    expect((await statusOnceRead(settingsAdmin)).estimate?.minutes).toBeNull();

    // What the worker saves when a build completes: six builds of the names step, of which the newest five are kept.
    const timing = (step: string, model: string, durationMs: number) => ({
      feature: 'story-guides',
      step,
      connectionId: connection!.id,
      model,
      units: 10,
      lanes: 1,
      durationMs,
      jobId: null,
    });
    const rates = ctx.app.get(AiStepRates, { strict: false });
    for (const seconds of [900, 10, 20, 30, 40, 50]) await rates.learn([timing('names', 'fast-e2e', seconds * 10_000)]);
    await rates.learn([timing('ties', 'fast-e2e', 100_000), timing('lines', 'fast-e2e', 200_000), timing('review', 'careful-e2e', 300_000)]);
    const kept = await ctx.db
      .select()
      .from(schema.aiStepTimings)
      .where(and(eq(schema.aiStepTimings.connectionId, connection!.id), eq(schema.aiStepTimings.step, 'names')));
    expect(kept).toHaveLength(AI_STEP_TIMINGS_KEPT);
    expect(kept.map((row) => row.durationMs)).not.toContain(9_000_000);

    const timed = (await status(settingsAdmin)).estimate;
    expect(timed?.minutes).toBeGreaterThan(0);

    expect((await call(builder, 'GET', '/admin/ai/features/story-guides/speeds')).statusCode).toBe(403);
    const speeds = await call(settingsAdmin, 'GET', '/admin/ai/features/story-guides/speeds');
    expect(speeds.statusCode).toBe(200);
    const listed = speeds.json<StoryGuideSpeeds>().models.filter((entry) => entry.connectionId === connection!.id);
    expect(listed.map((entry) => entry.model).sort()).toEqual(['careful-e2e', 'fast-e2e']);
    const fast = listed.find((entry) => entry.model === 'fast-e2e')!;
    expect(fast.connectionName).toBe(connection!.name);
    expect(fast.steps).toEqual([
      { step: 'names', secondsPerCall: 30, builds: AI_STEP_TIMINGS_KEPT },
      { step: 'ties', secondsPerCall: 10, builds: 1 },
      { step: 'lines', secondsPerCall: 20, builds: 1 },
    ]);

    const reset = { connectionId: connection!.id, model: 'careful-e2e' };
    expect((await call(builder, 'POST', '/admin/ai/features/story-guides/speeds/reset', reset)).statusCode).toBe(403);
    expect((await call(settingsAdmin, 'POST', '/admin/ai/features/story-guides/speeds/reset', { connectionId: connection!.id })).statusCode).toBe(
      400,
    );
    const done = await call(settingsAdmin, 'POST', '/admin/ai/features/story-guides/speeds/reset', reset);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ removed: 1 });
    // The review now has no speed on its model, so the whole build has no time again; the cost stays.
    const after = (await status(settingsAdmin)).estimate;
    expect(after?.minutes).toBeNull();
    expect(after).toHaveProperty('cost');

    for (let attempt = 0; ; attempt += 1) {
      const audits = await ctx.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.userId, settingsAdmin.userId), like(schema.auditLog.action, 'ai.speeds.%')));
      if (audits.length > 0 || attempt >= 50) {
        expect(audits.map((row) => row.action)).toEqual(['ai.speeds.reset']);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await ctx.db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'ai.slots'));
    await ctx.db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, connection!.id));
  });
});
