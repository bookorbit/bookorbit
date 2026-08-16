import { and, asc, eq, inArray } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { assertNoIntegrityViolations } from './e2e/app-harness';
import {
  apiJson,
  buildSnapshotConnectionConfig,
  closeMigrationCalibreWebAutomatedE2EContext,
  createMigrationCalibreWebAutomatedE2EContext,
  type MigrationCalibreWebAutomatedE2EContext,
  waitForMigrationToFinish,
} from './e2e/migration-calibre-web-automated/migration-calibre-web-automated-harness';
import {
  seedCalibreWebAutomatedTargetScenario,
  seedStoppedCalibreWebAutomatedSource,
  type CalibreWebAutomatedMigrationScenario,
  type CalibreWebAutomatedSourceFixture,
} from './e2e/migration-calibre-web-automated/migration-calibre-web-automated-fixture-builder';

describe('Migration Calibre-Web Automated stopped snapshot (e2e)', { timeout: 300_000 }, () => {
  let ctx: MigrationCalibreWebAutomatedE2EContext<CalibreWebAutomatedSourceFixture>;
  let scenario: CalibreWebAutomatedMigrationScenario;
  let captureLogs = false;

  beforeAll(async () => {
    ctx = await createMigrationCalibreWebAutomatedE2EContext(seedStoppedCalibreWebAutomatedSource);
    scenario = await seedCalibreWebAutomatedTargetScenario(ctx);
  }, 180_000);

  afterEach((taskContext) => {
    if (taskContext.task.result?.state !== 'pass') captureLogs = true;
  });

  afterAll(async () => {
    if (ctx) await closeMigrationCalibreWebAutomatedE2EContext(ctx, captureLogs);
  }, 60_000);

  it('imports a live-produced stopped snapshot with isolation and idempotency', async () => {
    expect(ctx.cwa.version).toMatch(/^CWA\//);
    const connectionConfig = buildSnapshotConnectionConfig(ctx);

    const supportedTypes = await apiJson<string[]>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/supported-types',
      token: ctx.adminToken,
    });
    expect(supportedTypes.statusCode).toBe(200);
    expect(supportedTypes.body).toContain('calibre_web_automated');

    const tested = await testSourceConnection(connectionConfig);
    expect(tested).toMatchObject({
      ok: true,
      sourceType: 'calibre_web_automated',
      sourceVersion: null,
      counts: {
        users: 3,
        books: 6,
        files: 7,
        userBookStatuses: 3,
        userFileProgress: 6,
        shelves: 2,
        shelfBooks: 4,
      },
    });
    expect(tested.warnings).toContain('Schema compatibility was verified against Calibre-Web Automated v4.0.6');

    const source = await createSource(connectionConfig);
    expect(source.type).toBe('calibre_web_automated');
    expect(source.connectionConfig).toEqual(connectionConfig);

    const validated = await validateSource(source.id);
    expect(validated.ok).toBe(true);
    expect(validated.sourceVersion).toBeNull();
    expect(validated.warnings).toContain('Schema compatibility was verified against Calibre-Web Automated v4.0.6');

    const prefixes = await apiJson<{ prefixes: string[] }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${source.id}/path-prefixes`,
      token: ctx.adminToken,
    });
    expect(prefixes.statusCode).toBe(200);
    expect(prefixes.body.prefixes).toEqual(['/calibre-library']);

    const suggestions = await apiJson<{
      suggestions: Array<{ sourceUserId: string; suggestedTargetUserId: number | null; confidence: string | null }>;
    }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${source.id}/user-mapping-suggestions`,
      token: ctx.adminToken,
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUserId: scenario.source.sourceUsers.maya,
          suggestedTargetUserId: scenario.targetUsers.maya.id,
          confidence: 'high',
        }),
        expect.objectContaining({
          sourceUserId: scenario.source.sourceUsers.theo,
          suggestedTargetUserId: scenario.targetUsers.theo.id,
          confidence: 'high',
        }),
        expect.objectContaining({
          sourceUserId: scenario.source.sourceUsers.lina,
          suggestedTargetUserId: scenario.targetUsers.lina.id,
          confidence: 'high',
        }),
      ]),
    );
    expect(suggestions.body.suggestions.map((row) => row.sourceUserId)).not.toContain(scenario.source.sourceUsers.guest);

    const profile = await createProfile(source.id);
    const pathValidation = await apiJson<{
      summary: { totalSourceBooks: number; mappedByPrefix: number; matchedTargetPaths: number; unmatchedTargetPaths: number };
    }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${source.id}/path-mappings/validate`,
      token: ctx.adminToken,
      payload: { pathMappings: scenario.pathMappings, sampleLimit: 10 },
    });
    expect(pathValidation.statusCode).toBe(201);
    expect(pathValidation.body.summary).toMatchObject({ totalSourceBooks: 6, mappedByPrefix: 6, matchedTargetPaths: 2 });

    const plan = await createDryRun(profile.id);
    expect(plan.summary).toMatchObject({ status: 'ready_for_live_run', matchedBooks: 5, unresolvedBooks: 1 });
    expect(plan.plan.matchedBooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBookId: String(scenario.source.books.cedar.id),
          targetBookId: scenario.targetBooks.cedar.bookId,
          strategy: 'isbn',
        }),
        expect.objectContaining({
          sourceBookId: String(scenario.source.books.tides.id),
          targetBookId: scenario.targetBooks.tides.bookId,
          strategy: 'path_mapping',
        }),
        expect.objectContaining({
          sourceBookId: String(scenario.source.books.quiet.id),
          targetBookId: scenario.targetBooks.quiet.bookId,
          strategy: 'title_author',
        }),
        expect.objectContaining({
          sourceBookId: String(scenario.source.books.clock.id),
          targetBookId: scenario.targetBooks.clock.bookId,
          strategy: 'asin',
        }),
        expect.objectContaining({
          sourceBookId: String(scenario.source.books.panels.id),
          targetBookId: scenario.targetBooks.panels.bookId,
          strategy: 'path_mapping',
        }),
      ]),
    );
    expect(plan.plan.unresolvedBooks).toEqual([
      expect.objectContaining({ sourceBookId: String(scenario.source.books.lantern.id), reason: 'no_title_author_match' }),
    ]);
    expect(plan.summary.perUserPreview.map((row) => row.sourceUserId)).toEqual(
      expect.arrayContaining([scenario.source.sourceUsers.maya, scenario.source.sourceUsers.theo]),
    );
    expect(plan.summary.perUserPreview.map((row) => row.sourceUserId)).not.toContain(scenario.source.sourceUsers.lina);

    const firstRun = await startRun(plan.id);
    expect(firstRun.progress.run.state).toBe('completed');
    expect(firstRun.report.run.state).toBe('completed');
    expect(firstRun.report.totals.failed).toBe(0);
    expect(firstRun.report.totals.unresolved).toBeGreaterThanOrEqual(1);
    await assertImportedState();
    const countsAfterFirstRun = await loadImportedStateCounts();

    const secondRun = await startRun(plan.id);
    expect(secondRun.progress.run.state).toBe('completed');
    expect(secondRun.report.totals.failed).toBe(0);
    expect(await loadImportedStateCounts()).toEqual(countsAfterFirstRun);
    await assertImportedState();
    await assertNoIntegrityViolations(ctx.db);
  });

  async function testSourceConnection(connectionConfig: Record<string, unknown>): Promise<{
    ok: boolean;
    sourceType: string;
    sourceVersion: string | null;
    warnings: string[];
    counts: Record<string, number>;
  }> {
    const response = await apiJson<{
      ok: boolean;
      sourceType: string;
      sourceVersion: string | null;
      warnings: string[];
      counts: Record<string, number>;
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources/test',
      token: ctx.adminToken,
      payload: { type: 'calibre_web_automated', connectionConfig },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function createSource(connectionConfig: Record<string, unknown>): Promise<{
    id: number;
    type: string;
    connectionConfig: Record<string, unknown>;
  }> {
    const response = await apiJson<{ id: number; type: string; connectionConfig: Record<string, unknown> }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: { type: 'calibre_web_automated', name: 'Stopped CWA v4.0.6', connectionConfig },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function validateSource(sourceId: number): Promise<{ ok: boolean; sourceVersion: string | null; warnings: string[] }> {
    const response = await apiJson<{ ok: boolean; sourceVersion: string | null; warnings: string[] }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${sourceId}/validate`,
      token: ctx.adminToken,
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  async function createProfile(sourceId: number): Promise<{ id: number }> {
    const response = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId,
        name: 'CWA snapshot profile',
        userMappings: [
          { sourceUserId: scenario.source.sourceUsers.maya, targetUserId: scenario.targetUsers.maya.id },
          { sourceUserId: scenario.source.sourceUsers.theo, targetUserId: scenario.targetUsers.theo.id },
        ],
        pathMappings: scenario.pathMappings,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function createDryRun(profileId: number): Promise<{
    id: number;
    summary: {
      status: string;
      matchedBooks: number;
      unresolvedBooks: number;
      perUserPreview: Array<{ sourceUserId: string; targetUserId: number; counts: Record<string, number> }>;
    };
    plan: {
      matchedBooks: Array<{ sourceBookId: string; targetBookId: number; strategy: string }>;
      unresolvedBooks: Array<{ sourceBookId: string; reason: string }>;
    };
  }> {
    const response = await apiJson<{
      id: number;
      summary: {
        status: string;
        matchedBooks: number;
        unresolvedBooks: number;
        perUserPreview: Array<{ sourceUserId: string; targetUserId: number; counts: Record<string, number> }>;
      };
      plan: {
        matchedBooks: Array<{ sourceBookId: string; targetBookId: number; strategy: string }>;
        unresolvedBooks: Array<{ sourceBookId: string; reason: string }>;
      };
    }>(ctx, { method: 'POST', url: '/api/v1/migration/plans/dry-run', token: ctx.adminToken, payload: { profileId } });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function startRun(planArtifactId: number) {
    const response = await apiJson<{ id: number; state: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body.state).toBe('running');
    return waitForMigrationToFinish(ctx, response.body.id);
  }

  async function assertImportedState(): Promise<void> {
    const readingRows = await ctx.db
      .select()
      .from(schema.readingProgress)
      .where(inArray(schema.readingProgress.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id, scenario.targetUsers.lina.id]));
    expect(readingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookFileId: scenario.targetBooks.cedar.fileIds[0],
          cfi: scenario.source.expected.cedarCfi,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookFileId: scenario.targetBooks.tides.fileIds[1],
          percentage: scenario.source.expected.koboPercentage,
          cfi: scenario.source.expected.koboCfi,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.theo.id,
          bookFileId: scenario.targetBooks.quiet.fileIds[0],
          percentage: scenario.source.expected.quietPercentage,
          cfi: scenario.source.expected.quietCfi,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.theo.id,
          bookFileId: scenario.targetBooks.panels.fileIds[0],
          pageNumber: scenario.source.expected.comicPageNumber,
        }),
      ]),
    );
    expect(readingRows.some((row) => row.userId === scenario.targetUsers.maya.id && row.bookFileId === scenario.targetBooks.tides.fileIds[0])).toBe(
      false,
    );
    expect(
      readingRows.some(
        (row) =>
          row.userId === scenario.targetUsers.maya.id &&
          [scenario.targetBooks.quiet.fileIds[0], scenario.targetBooks.panels.fileIds[0]].includes(row.bookFileId),
      ),
    ).toBe(false);
    expect(readingRows.filter((row) => row.userId === scenario.targetUsers.lina.id)).toEqual([]);

    const unrelatedProgress = readingRows.find(
      (row) => row.userId === scenario.targetUsers.maya.id && row.bookFileId === scenario.targetBooks.unrelated.fileIds[0],
    );
    expect(unrelatedProgress).toMatchObject({ percentage: 12, cfi: 'epubcfi(/6/2[chapter]!/4/2/2:3)' });

    const audioRows = await ctx.db
      .select()
      .from(schema.audiobookProgress)
      .where(inArray(schema.audiobookProgress.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id, scenario.targetUsers.lina.id]));
    expect(audioRows).toEqual([
      expect.objectContaining({
        userId: scenario.targetUsers.maya.id,
        bookId: scenario.targetBooks.clock.bookId,
        currentFileId: scenario.targetBooks.clock.fileIds[0],
        percentage: 0,
        positionSeconds: scenario.source.expected.audioPositionSeconds,
      }),
    ]);

    const statuses = await ctx.db
      .select()
      .from(schema.userBookStatus)
      .where(inArray(schema.userBookStatus.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id, scenario.targetUsers.lina.id]));
    const theoFinished = statuses.find((row) => row.userId === scenario.targetUsers.theo.id && row.bookId === scenario.targetBooks.cedar.bookId);
    expect(theoFinished).toMatchObject({ status: 'read', source: 'manual' });
    expect(theoFinished?.startedAt?.toISOString()).toBe(scenario.source.expected.theoStartedAt);
    expect(theoFinished?.finishedAt?.toISOString()).toBe(scenario.source.expected.theoFinishedAt);
    expect(statuses.filter((row) => row.userId === scenario.targetUsers.lina.id)).toEqual([]);

    const importedCollection = await ctx.db.query.collections.findFirst({
      where: and(eq(schema.collections.userId, scenario.targetUsers.maya.id), eq(schema.collections.name, 'Maya Reading Order')),
    });
    expect(importedCollection).toBeDefined();
    const collectionMembers = await ctx.db
      .select({ bookId: schema.collectionBooks.bookId })
      .from(schema.collectionBooks)
      .where(eq(schema.collectionBooks.collectionId, importedCollection!.id))
      .orderBy(asc(schema.collectionBooks.position));
    expect(collectionMembers.map((row) => row.bookId)).toEqual([scenario.targetBooks.tides.bookId, scenario.targetBooks.cedar.bookId]);
    expect(
      await ctx.db.query.collections.findFirst({
        where: and(eq(schema.collections.userId, scenario.targetUsers.theo.id), eq(schema.collections.name, 'Maya Reading Order')),
      }),
    ).toBeUndefined();
    expect((await ctx.db.select().from(schema.collections).where(eq(schema.collections.userId, scenario.targetUsers.lina.id))).length).toBe(0);

    const preexistingCollection = await ctx.db.query.collections.findFirst({
      where: eq(schema.collections.id, scenario.preexistingCollectionId),
    });
    expect(preexistingCollection?.name).toBe('Before Migration');
  }

  async function loadImportedStateCounts(): Promise<Record<string, number>> {
    const [statuses, reading, audio, collections, collectionBooks] = await Promise.all([
      ctx.db.select().from(schema.userBookStatus),
      ctx.db.select().from(schema.readingProgress),
      ctx.db.select().from(schema.audiobookProgress),
      ctx.db.select().from(schema.collections),
      ctx.db.select().from(schema.collectionBooks),
    ]);
    return {
      statuses: statuses.length,
      reading: reading.length,
      audio: audio.length,
      collections: collections.length,
      collectionBooks: collectionBooks.length,
    };
  }
});
