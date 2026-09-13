import { eq, inArray } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { AudiobookshelfSourceAdapter } from '../src/modules/migration/adapters/audiobookshelf/audiobookshelf-source.adapter';
import type { AudiobookshelfConnectionConfig } from '../src/modules/migration/adapters/audiobookshelf/audiobookshelf-connection-config';
import { assertNoIntegrityViolations } from './e2e/app-harness';
import {
  apiJson,
  buildBackupConnectionConfig,
  closeMigrationAudiobookshelfE2EContext,
  createMigrationAudiobookshelfE2EContext,
  resolveBackupPath,
  type MigrationAudiobookshelfE2EContext,
  waitForMigrationToFinish,
} from './e2e/migration-audiobookshelf/migration-audiobookshelf-harness';
import {
  createAudiobookshelfMediaFixtures,
  seedAudiobookshelfMigrationScenario,
  type AudiobookshelfMigrationScenario,
} from './e2e/migration-audiobookshelf/migration-audiobookshelf-fixture-builder';

describe('Migration Audiobookshelf live and backup (e2e)', { timeout: 300_000 }, () => {
  let ctx: MigrationAudiobookshelfE2EContext;
  let scenario: AudiobookshelfMigrationScenario;
  let captureLogs = false;

  beforeAll(async () => {
    ctx = await createMigrationAudiobookshelfE2EContext(createAudiobookshelfMediaFixtures);
    scenario = await seedAudiobookshelfMigrationScenario(ctx);
  }, 150_000);

  afterEach((taskContext) => {
    if (taskContext.task.result?.state !== 'pass') captureLogs = true;
  });

  afterAll(async () => {
    if (ctx) await closeMigrationAudiobookshelfE2EContext(ctx, captureLogs);
  }, 60_000);

  it('imports live state and proves real-backup normalization and planning parity', async () => {
    const supportedTypes = await apiJson<string[]>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/supported-types',
      token: ctx.adminToken,
    });
    expect(supportedTypes.statusCode).toBe(200);
    expect(supportedTypes.body).toContain('audiobookshelf');

    const testedLive = await testSourceConnection(scenario.apiConnectionConfig);
    expect(testedLive.ok).toBe(true);
    expect(testedLive.sourceType).toBe('audiobookshelf');
    expect(testedLive.sourceVersion).toBe('2.36.0');
    // Live validation reports the cheap summary rather than exporting the whole library.
    expect(testedLive.counts).toMatchObject({ users: 4, libraryItems: 5, mediaProgress: 6, bookmarks: 2 });

    const liveSource = await createSource('Live Audiobookshelf', scenario.apiConnectionConfig);
    expect(liveSource.connectionConfig).toMatchObject({
      mode: 'api',
      baseUrl: ctx.audiobookshelf.baseUrl,
      apiToken: '********',
      allowPrivateNetwork: true,
    });
    const liveValidation = await validateSource(liveSource.id);
    expect(liveValidation).toMatchObject({ ok: true, sourceVersion: '2.36.0', warnings: [] });

    const prefixes = await apiJson<{ prefixes: string[] }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${liveSource.id}/path-prefixes`,
      token: ctx.adminToken,
    });
    expect(prefixes.statusCode).toBe(200);
    expect(prefixes.body.prefixes).toEqual(['/audiobooks']);

    const suggestions = await apiJson<{
      suggestions: Array<{ sourceUserId: string; suggestedTargetUserId: number | null; confidence: string | null }>;
    }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${liveSource.id}/user-mapping-suggestions`,
      token: ctx.adminToken,
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUserId: scenario.sourceUsers.maya.id,
          suggestedTargetUserId: scenario.targetUsers.maya.id,
          confidence: 'high',
        }),
        expect.objectContaining({
          sourceUserId: scenario.sourceUsers.theo.id,
          suggestedTargetUserId: scenario.targetUsers.theo.id,
          confidence: 'high',
        }),
      ]),
    );

    const liveProfile = await createProfile(liveSource.id, 'Live Audiobookshelf Profile');
    const pathValidation = await apiJson<{
      summary: { totalSourceBooks: number; mappedByPrefix: number; matchedTargetPaths: number };
    }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${liveSource.id}/path-mappings/validate`,
      token: ctx.adminToken,
      payload: { pathMappings: scenario.pathMappings, sampleLimit: 10 },
    });
    expect(pathValidation.statusCode).toBe(201);
    expect(pathValidation.body.summary).toMatchObject({ totalSourceBooks: 5, mappedByPrefix: 5, matchedTargetPaths: 0 });

    const livePlan = await createDryRun(liveProfile.id);
    expect(livePlan.summary).toMatchObject({ status: 'ready_for_live_run', matchedBooks: 4, unresolvedBooks: 1 });
    expect(livePlan.plan.matchedBooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetBookId: scenario.targetBooks.glass.bookId, strategy: 'path_mapping' }),
        expect.objectContaining({ targetBookId: scenario.targetBooks.map.bookId, strategy: 'isbn' }),
        expect.objectContaining({ targetBookId: scenario.targetBooks.brass.bookId, strategy: 'asin' }),
        expect.objectContaining({ targetBookId: scenario.targetBooks.northbound.bookId, strategy: 'title_author' }),
      ]),
    );
    expect(livePlan.plan.unresolvedBooks).toEqual([
      expect.objectContaining({ sourceBookId: scenario.sourceItems.lanterns.media.id, reason: 'no_title_author_match' }),
    ]);
    expect(livePlan.summary.perUserPreview).toHaveLength(2);
    expect(livePlan.summary.perUserPreview.map((row) => row.sourceUserId)).not.toContain(scenario.sourceUsers.lina.id);

    const backupPath = await resolveBackupPath(ctx);
    const backupConfig = buildBackupConnectionConfig(backupPath);
    const testedBackup = await testSourceConnection(backupConfig);
    expect(testedBackup).toMatchObject({ ok: true, sourceType: 'audiobookshelf', sourceVersion: '2.36.0' });
    // A backup is a local file, so its validation still reports full normalized counts. Live
    // and backup parity is proven by the canonicalized export comparison below.
    expect(testedBackup.counts).toMatchObject({ users: 4, books: 5, userBookStatuses: 6, bookmarks: 2 });

    const adapter = ctx.app.get(AudiobookshelfSourceAdapter);
    const liveExport = await adapter.exportData(scenario.apiConnectionConfig as AudiobookshelfConnectionConfig);
    const backupExport = await adapter.exportData(backupConfig as AudiobookshelfConnectionConfig);
    expect(canonicalizeExport(backupExport)).toEqual(canonicalizeExport(liveExport));

    await ctx.db.insert(schema.userBookStatus).values([
      {
        userId: scenario.targetUsers.theo.id,
        bookId: scenario.targetBooks.glass.bookId,
        status: 'read',
        source: 'manual',
        finishedAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        userId: scenario.targetUsers.maya.id,
        bookId: scenario.targetBooks.glass.bookId,
        status: 'want_to_read',
        source: 'manual',
        updatedAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        userId: scenario.targetUsers.theo.id,
        bookId: scenario.targetBooks.map.bookId,
        status: 'want_to_read',
        source: 'manual',
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);

    const started = await apiJson<{ id: number; state: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: livePlan.id },
    });
    expect(started.statusCode).toBe(201);
    expect(started.body.state).toBe('running');
    const finished = await waitForMigrationToFinish(ctx, started.body.id);
    expect(finished.progress.run.state).toBe('completed');
    expect(finished.report.run.state).toBe('completed');
    expect(finished.report.totals.failed).toBe(0);
    expect(finished.report.totals.unresolved).toBeGreaterThanOrEqual(1);

    const mergedStatuses = await ctx.db
      .select()
      .from(schema.userBookStatus)
      .where(inArray(schema.userBookStatus.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id]));
    expect(mergedStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.theo.id,
          bookId: scenario.targetBooks.glass.bookId,
          status: 'read',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookId: scenario.targetBooks.glass.bookId,
          status: 'want_to_read',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.theo.id,
          bookId: scenario.targetBooks.map.bookId,
          status: 'read',
        }),
      ]),
    );

    await assertImportedState();
    const countsAfterFirstRun = await loadStateCounts();

    const repeated = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: livePlan.id },
    });
    expect(repeated.statusCode).toBe(201);
    expect((await waitForMigrationToFinish(ctx, repeated.body.id)).progress.run.state).toBe('completed');
    expect(await loadStateCounts()).toEqual(countsAfterFirstRun);
    await assertImportedState();

    const backupSource = await createSource('Backup Audiobookshelf', backupConfig);
    const backupValidation = await validateSource(backupSource.id);
    expect(backupValidation).toMatchObject({ ok: true, sourceVersion: '2.36.0' });
    const backupProfile = await createProfile(backupSource.id, 'Backup Audiobookshelf Profile');
    const backupPlan = await createDryRun(backupProfile.id);
    expect(backupPlan.summary).toMatchObject({
      matchedBooks: livePlan.summary.matchedBooks,
      unresolvedBooks: livePlan.summary.unresolvedBooks,
    });
    expect(backupPlan.plan.matchedBooks.map(({ targetBookId, strategy }) => ({ targetBookId, strategy })).sort(byTargetBookId)).toEqual(
      livePlan.plan.matchedBooks.map(({ targetBookId, strategy }) => ({ targetBookId, strategy })).sort(byTargetBookId),
    );
    expect(backupPlan.summary.perUserPreview).toEqual(livePlan.summary.perUserPreview);
    await assertNoIntegrityViolations(ctx.db);
  });

  async function testSourceConnection(connectionConfig: Record<string, unknown>) {
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
      payload: { type: 'audiobookshelf', connectionConfig },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function createSource(name: string, connectionConfig: Record<string, unknown>) {
    const response = await apiJson<{ id: number; connectionConfig: Record<string, unknown> }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: { type: 'audiobookshelf', name, connectionConfig },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async function validateSource(sourceId: number) {
    const response = await apiJson<{ ok: boolean; sourceVersion: string | null; warnings: string[] }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${sourceId}/validate`,
      token: ctx.adminToken,
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  async function createProfile(sourceId: number, name: string): Promise<{ id: number }> {
    const response = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId,
        name,
        userMappings: [
          { sourceUserId: scenario.sourceUsers.maya.id, targetUserId: scenario.targetUsers.maya.id },
          { sourceUserId: scenario.sourceUsers.theo.id, targetUserId: scenario.targetUsers.theo.id },
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

  async function assertImportedState(): Promise<void> {
    const audioRows = await ctx.db
      .select()
      .from(schema.audiobookProgress)
      .where(inArray(schema.audiobookProgress.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id]));
    expect(audioRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookId: scenario.targetBooks.glass.bookId,
          currentFileId: scenario.targetBooks.glass.fileIds[1],
          percentage: 50,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookId: scenario.targetBooks.northbound.bookId,
          currentFileId: scenario.targetBooks.northbound.fileIds[1],
          percentage: 25,
        }),
      ]),
    );
    const glassAudio = audioRows.find((row) => row.userId === scenario.targetUsers.maya.id && row.bookId === scenario.targetBooks.glass.bookId);
    expect(glassAudio?.positionSeconds).toBeCloseTo(15, 0);

    const readingRows = await ctx.db
      .select()
      .from(schema.readingProgress)
      .where(inArray(schema.readingProgress.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id]));
    expect(readingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookFileId: scenario.targetBooks.map.fileIds[0],
          percentage: 37.5,
          cfi: scenario.expected.mayaCfi,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.maya.id,
          bookFileId: scenario.targetBooks.northbound.fileIds[0],
          percentage: 62.5,
        }),
      ]),
    );
    expect(readingRows.some((row) => scenario.targetBooks.northbound.fileIds[1] === row.bookFileId)).toBe(false);

    const statusRows = await ctx.db
      .select()
      .from(schema.userBookStatus)
      .where(inArray(schema.userBookStatus.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id]));
    const theoMap = statusRows.find((row) => row.userId === scenario.targetUsers.theo.id && row.bookId === scenario.targetBooks.map.bookId);
    const theoBrass = statusRows.find((row) => row.userId === scenario.targetUsers.theo.id && row.bookId === scenario.targetBooks.brass.bookId);
    expect(theoMap).toMatchObject({ status: 'read', source: 'manual' });
    expect(theoMap?.finishedAt?.toISOString()).toBe(scenario.expected.theoMapFinishedAt);
    expect(theoBrass).toMatchObject({ status: 'read', source: 'manual' });
    expect(theoBrass?.finishedAt?.toISOString()).toBe(scenario.expected.theoBrassFinishedAt);

    const bookmarkRows = await ctx.db.select().from(schema.bookmarks).where(eq(schema.bookmarks.userId, scenario.targetUsers.maya.id));
    expect(bookmarkRows).toEqual([
      expect.objectContaining({
        bookId: scenario.targetBooks.glass.bookId,
        title: 'Harbor entrance',
        positionSeconds: 42,
      }),
    ]);
    expect(bookmarkRows[0].createdAt).toBeInstanceOf(Date);

    const allUserIds = new Set([
      ...audioRows.map((row) => row.userId),
      ...readingRows.map((row) => row.userId),
      ...statusRows.map((row) => row.userId),
      ...bookmarkRows.map((row) => row.userId),
    ]);
    expect([...allUserIds].every((id) => id === scenario.targetUsers.maya.id || id === scenario.targetUsers.theo.id)).toBe(true);
    const nonAudioReferences = await ctx.db
      .select({ format: schema.bookFiles.format })
      .from(schema.audiobookProgress)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.audiobookProgress.currentFileId))
      .where(inArray(schema.audiobookProgress.userId, [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id]));
    expect(nonAudioReferences.every((row) => row.format === 'mp3')).toBe(true);
  }

  async function loadStateCounts(): Promise<Record<string, number>> {
    const userIds = [scenario.targetUsers.maya.id, scenario.targetUsers.theo.id];
    const [statuses, reading, audio, bookmarks, sessions] = await Promise.all([
      ctx.db.select().from(schema.userBookStatus).where(inArray(schema.userBookStatus.userId, userIds)),
      ctx.db.select().from(schema.readingProgress).where(inArray(schema.readingProgress.userId, userIds)),
      ctx.db.select().from(schema.audiobookProgress).where(inArray(schema.audiobookProgress.userId, userIds)),
      ctx.db.select().from(schema.bookmarks).where(inArray(schema.bookmarks.userId, userIds)),
      ctx.db.select().from(schema.readingSessions).where(inArray(schema.readingSessions.userId, userIds)),
    ]);
    return { statuses: statuses.length, reading: reading.length, audio: audio.length, bookmarks: bookmarks.length, sessions: sessions.length };
  }
});

function canonicalizeExport(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeExport).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeExport(entry)]),
    );
  }
  return value;
}

function byTargetBookId(left: { targetBookId: number }, right: { targetBookId: number }): number {
  return left.targetBookId - right.targetBookId;
}
