import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { eq, inArray } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { assertNoIntegrityViolations } from './e2e/app-harness';
import {
  apiJson,
  apiText,
  buildBookloreConnectionConfig,
  closeMigrationBookloreE2EContext,
  coverDirectoryForBook,
  createMigrationBookloreE2EContext,
  createUser,
  resetMigrationBookloreState,
  type MigrationBookloreE2EContext,
  waitForMigrationToFinish,
} from './e2e/migration-booklore/migration-booklore-harness';
import {
  seedCanonicalScenario,
  seedCompatibilityScenario,
  seedMissingRequiredTablesScenario,
  seedWarningsOnlyScenario,
} from './e2e/migration-booklore/migration-booklore-fixture-builder';

interface MetricRow {
  stage: string;
  entityType: string;
  processed: number;
  imported: number;
  skipped: number;
  unresolved: number;
  failed: number;
  updatedAt: string;
}

describe('Migration Booklore API to DB (e2e)', { timeout: 240_000 }, () => {
  let ctx: MigrationBookloreE2EContext | null = null;

  beforeAll(async () => {
    ctx = await createMigrationBookloreE2EContext();
  }, 60_000);

  beforeEach(async () => {
    if (!ctx) throw new Error('Migration Booklore test context failed to initialize');
    await resetMigrationBookloreState(ctx);
  }, 60_000);

  afterAll(async () => {
    if (!ctx) return;
    await closeMigrationBookloreE2EContext(ctx);
  }, 60_000);

  it('imports canonical Booklore data from API through Postgres and covers', async () => {
    const scenario = await seedCanonicalScenario(ctx);

    const supportedTypes = await apiJson<string[]>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/supported-types',
      token: ctx.adminToken,
    });
    expect(supportedTypes.statusCode).toBe(200);
    expect(supportedTypes.body).toEqual(['booklore']);

    const testedSource = await apiJson<{
      ok: boolean;
      sourceType: string;
      warnings: string[];
      counts: Record<string, number>;
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources/test',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(testedSource.statusCode).toBe(201);
    expect(testedSource.body.ok).toBe(true);
    expect(testedSource.body.sourceType).toBe('booklore');
    expect(testedSource.body.warnings).toEqual([]);
    expect(testedSource.body.counts.book).toBe(7);

    const createdSource = await apiJson<{
      id: number;
      type: string;
      name: string;
      connectionConfig: Record<string, unknown>;
      lastValidatedAt: string | null;
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        name: 'Canonical Booklore',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(createdSource.statusCode).toBe(201);
    expect(createdSource.body.connectionConfig).toMatchObject({
      host: '127.0.0.1',
      user: 'booklore',
      database: 'booklore',
      password: '********',
      mediaRootPath: ctx.sourceMediaRoot,
    });

    const sourceId = createdSource.body.id;

    const validatedSource = await apiJson<{
      ok: boolean;
      missingTables: string[];
      warnings: string[];
    }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${sourceId}/validate`,
      token: ctx.adminToken,
    });
    expect(validatedSource.statusCode).toBe(200);
    expect(validatedSource.body.ok).toBe(true);
    expect(validatedSource.body.missingTables).toEqual([]);
    expect(validatedSource.body.warnings).toEqual([]);

    const sourcePrefixes = await apiJson<{ prefixes: string[] }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${sourceId}/path-prefixes`,
      token: ctx.adminToken,
    });
    expect(sourcePrefixes.statusCode).toBe(200);
    expect(sourcePrefixes.body.prefixes).toEqual(['/booklore-media/library']);

    const suggestions = await apiJson<{
      sourceId: number;
      suggestions: Array<{
        sourceUserId: string;
        suggestedTargetUserId: number | null;
        confidence: string | null;
      }>;
    }>(ctx, {
      method: 'GET',
      url: `/api/v1/migration/sources/${sourceId}/user-mapping-suggestions`,
      token: ctx.adminToken,
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.body.sourceId).toBe(sourceId);
    expect(suggestions.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUserId: '1',
          suggestedTargetUserId: scenario.targetUsers.alice.id,
          confidence: 'high',
        }),
        expect.objectContaining({
          sourceUserId: '2',
          suggestedTargetUserId: scenario.targetUsers.bob.id,
          confidence: 'high',
        }),
      ]),
    );

    const profile = await apiJson<{
      id: number;
      sourceId: number;
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId,
        name: 'Canonical Profile',
        userMappings: [
          { sourceUserId: '1', targetUserId: scenario.targetUsers.alice.id },
          { sourceUserId: '2', targetUserId: scenario.targetUsers.bob.id },
        ],
        pathMappings: scenario.pathMappings,
      },
    });
    expect(profile.statusCode).toBe(201);
    expect(profile.body.sourceId).toBe(sourceId);

    const pathValidation = await apiJson<{
      sourceId: number;
      persistedProfileId: number | null;
      summary: {
        totalSourceBooks: number;
        booksWithFilePath: number;
        mappedByPrefix: number;
        matchedTargetPaths: number;
        unmatchedTargetPaths: number;
      };
    }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${sourceId}/path-mappings/validate`,
      token: ctx.adminToken,
      payload: {
        pathMappings: scenario.pathMappings,
        sampleLimit: 5,
      },
    });
    expect(pathValidation.statusCode).toBe(201);
    expect(pathValidation.body.sourceId).toBe(sourceId);
    expect(pathValidation.body.persistedProfileId).toBe(profile.body.id);
    expect(pathValidation.body.summary.totalSourceBooks).toBe(7);
    expect(pathValidation.body.summary.booksWithFilePath).toBe(7);
    expect(pathValidation.body.summary.mappedByPrefix).toBe(2);
    expect(pathValidation.body.summary.matchedTargetPaths).toBe(2);
    expect(pathValidation.body.summary.unmatchedTargetPaths).toBe(5);

    const dryRun = await apiJson<{
      id: number;
      profileId: number;
      plan: {
        duplicateBookMatches: Array<{ targetBookId: number; sourceBookIds: string[] }>;
      };
      summary: {
        status: string;
        matchedBooks: number;
        unresolvedBooks: number;
        duplicateBookMatches: number;
        perUserPreview: Array<{
          sourceUserId: string;
          targetUserId: number;
          counts: { statuses: number; fileProgress: number; bookmarks: number; annotations: number; shelves: number };
        }>;
      };
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/plans/dry-run',
      token: ctx.adminToken,
      payload: {
        profileId: profile.body.id,
      },
    });
    expect(dryRun.statusCode).toBe(201);
    expect(dryRun.body.profileId).toBe(profile.body.id);
    expect(dryRun.body.summary.status).toBe('blocked');
    expect(dryRun.body.summary.matchedBooks).toBe(4);
    expect(dryRun.body.summary.unresolvedBooks).toBe(1);
    expect(dryRun.body.summary.duplicateBookMatches).toBe(1);
    expect(dryRun.body.plan.duplicateBookMatches).toEqual([
      expect.objectContaining({
        targetBookId: scenario.books.duplicate.bookId,
        sourceBookIds: [scenario.sourceBookIds.duplicatePreferred, scenario.sourceBookIds.duplicateRejected],
      }),
    ]);
    expect(dryRun.body.summary.perUserPreview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUserId: '1',
          targetUserId: scenario.targetUsers.alice.id,
          counts: expect.objectContaining({
            statuses: 1,
            fileProgress: 2,
            bookmarks: 1,
            annotations: 1,
            shelves: 2,
          }),
        }),
        expect.objectContaining({
          sourceUserId: '2',
          targetUserId: scenario.targetUsers.bob.id,
          counts: expect.objectContaining({
            statuses: 1,
            fileProgress: 1,
            bookmarks: 1,
            annotations: 1,
            shelves: 1,
          }),
        }),
      ]),
    );

    const blockedRun = await apiJson<{ message: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: dryRun.body.id },
    });
    expectError(blockedRun, 400, 'duplicate target book matches');

    const resolvedPlan = await apiJson<{
      id: number;
      summary: {
        status: string;
        matchedBooks: number;
        unresolvedBooks: number;
        duplicateBookMatches: number;
        unresolvedByReason: Record<string, number>;
      };
      plan: {
        duplicateBookMatches: unknown[];
      };
    }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/plans/${dryRun.body.id}/resolve-duplicates`,
      token: ctx.adminToken,
      payload: {
        resolutions: [{ targetBookId: scenario.books.duplicate.bookId, selectedSourceBookId: scenario.sourceBookIds.duplicatePreferred }],
      },
    });
    expect(resolvedPlan.statusCode).toBe(200);
    expect(resolvedPlan.body.summary.status).toBe('ready_for_live_run');
    expect(resolvedPlan.body.summary.matchedBooks).toBe(5);
    expect(resolvedPlan.body.summary.unresolvedBooks).toBe(2);
    expect(resolvedPlan.body.summary.duplicateBookMatches).toBe(0);
    expect(resolvedPlan.body.summary.unresolvedByReason).toEqual({
      no_title_author_match: 1,
      duplicate_target_match: 1,
    });
    expect(resolvedPlan.body.plan.duplicateBookMatches).toEqual([]);

    const startedRun = await apiJson<{
      id: number;
      state: string;
      currentStage: string | null;
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: resolvedPlan.body.id },
    });
    expect(startedRun.statusCode).toBe(201);
    expect(startedRun.body.state).toBe('running');
    expect(startedRun.body.currentStage).toBe('init');

    const finished = await waitForMigrationToFinish(ctx, startedRun.body.id);
    expect(finished.progress.run.state).toBe('completed');
    expect(finished.report.run.state).toBe('completed');
    expect(finished.report.plan).not.toBeNull();
    expect(finished.report.summary).not.toBeNull();

    const workflowState = await apiJson<{
      active: {
        source: { id: number; connectionConfig: Record<string, unknown> };
        profile: { id: number } | null;
        plan: { id: number } | null;
        run: { id: number; state: string } | null;
      } | null;
      hasActiveRun: boolean;
    }>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/state',
      token: ctx.adminToken,
    });
    expect(workflowState.statusCode).toBe(200);
    expect(workflowState.body.hasActiveRun).toBe(false);
    expect(workflowState.body.active).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          id: sourceId,
          connectionConfig: expect.objectContaining({
            host: '127.0.0.1',
            user: 'booklore',
            password: '********',
          }),
        }),
        profile: expect.objectContaining({ id: profile.body.id }),
        plan: expect.objectContaining({ id: resolvedPlan.body.id }),
        run: expect.objectContaining({ id: startedRun.body.id, state: 'completed' }),
      }),
    );

    const jsonExport = await apiText(ctx, {
      method: 'GET',
      url: `/api/v1/migration/runs/${startedRun.body.id}/report/export?format=json`,
      token: ctx.adminToken,
    });
    expect(jsonExport.statusCode).toBe(200);
    expect(jsonExport.headers['content-type']).toContain('application/json');
    const parsedJsonExport = JSON.parse(jsonExport.body) as {
      run: { state: string };
      details: {
        matchedBooks: Array<{ sourceBookId: string; sourceTitle: string | null; targetBookId: number; strategy: string }>;
        userPreview: unknown[];
      };
    };
    expect(parsedJsonExport.run.state).toBe('completed');
    expect(parsedJsonExport.details.matchedBooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBookId: '101',
          sourceTitle: 'Imported ISBN Title',
          targetBookId: scenario.books.isbn.bookId,
          strategy: 'isbn',
        }),
      ]),
    );
    expect(parsedJsonExport.details.userPreview).toHaveLength(2);

    const csvExport = await apiText(ctx, {
      method: 'GET',
      url: `/api/v1/migration/runs/${startedRun.body.id}/report/export?format=csv`,
      token: ctx.adminToken,
    });
    expect(csvExport.statusCode).toBe(200);
    expect(csvExport.headers['content-type']).toContain('text/csv');
    expect(csvExport.body).toContain(
      'section,stage,entityType,processed,imported,skipped,unresolved,failed,sourceBookId,sourceTitle,sourceAuthor,targetBookId,targetTitle,strategy,sourceUserId,targetUserId,username,reason,details,code,message,createdAt',
    );
    expect(csvExport.body).toContain('matched_books,shared_overlays,book_match');
    expect(csvExport.body).toContain('Imported ISBN Title');

    const reportDetails = finished.report.details as {
      matchedBooks?: Array<{ sourceBookId: string; sourceTitle: string | null; targetBookId: number; strategy: string }>;
      userPreview?: Array<{ username: string; counts: Record<string, number> }>;
    };
    expect(reportDetails.matchedBooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBookId: '101',
          sourceTitle: 'Imported ISBN Title',
          targetBookId: scenario.books.isbn.bookId,
          strategy: 'isbn',
        }),
        expect.objectContaining({
          sourceBookId: '102',
          sourceTitle: 'Imported Hash Title',
          targetBookId: scenario.books.hash.bookId,
          strategy: 'file_hash',
        }),
      ]),
    );
    expect(reportDetails.userPreview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'alice-source',
          counts: expect.objectContaining({ statuses: 2, fileProgress: 2, bookmarks: 1, annotations: 1, shelves: 2 }),
        }),
        expect.objectContaining({
          username: 'bob-source',
          counts: expect.objectContaining({ statuses: 1, fileProgress: 1, bookmarks: 1, annotations: 1, shelves: 1 }),
        }),
      ]),
    );

    const metricByKey = buildMetricMap(finished.report.metrics as MetricRow[]);
    expect(metricByKey.get('shared_overlays:book_metadata')).toMatchObject({
      processed: 5,
      imported: 5,
      skipped: 0,
      unresolved: 0,
      failed: 0,
    });
    expect(metricByKey.get('shared_overlays:book_authors')).toMatchObject({
      processed: 5,
      imported: 7,
    });
    expect(metricByKey.get('shared_overlays:book_narrators')).toMatchObject({
      processed: 5,
      imported: 4,
    });
    expect(metricByKey.get('shared_overlays:book_genres')).toMatchObject({
      processed: 5,
      imported: 3,
    });
    expect(metricByKey.get('shared_overlays:book_tags')).toMatchObject({
      processed: 5,
      imported: 3,
    });
    expect(metricByKey.get('book_covers:book_covers')).toMatchObject({
      processed: 5,
      imported: 2,
      unresolved: 3,
      failed: 0,
    });
    expect(metricByKey.get('user_state:user_book_status')).toMatchObject({
      processed: 4,
      imported: 3,
      unresolved: 1,
    });
    expect(metricByKey.get('user_state:reading_progress')).toMatchObject({
      processed: 4,
      imported: 3,
      unresolved: 1,
    });
    expect(metricByKey.get('user_state:audiobook_progress')).toMatchObject({
      processed: 1,
      imported: 1,
    });
    expect(metricByKey.get('user_state:bookmarks')).toMatchObject({
      processed: 2,
      imported: 2,
    });
    expect(metricByKey.get('user_state:annotations')).toMatchObject({
      processed: 2,
      imported: 2,
    });
    expect(metricByKey.get('user_state:collections')).toMatchObject({
      processed: 3,
      imported: 3,
    });

    const metadataRows = await ctx.db
      .select()
      .from(schema.bookMetadata)
      .where(
        inArray(schema.bookMetadata.bookId, [
          scenario.books.isbn.bookId,
          scenario.books.hash.bookId,
          scenario.books.audio.bookId,
          scenario.books.titleAuthor.bookId,
          scenario.books.duplicate.bookId,
        ]),
      );
    const metadataByBookId = new Map(metadataRows.map((row) => [row.bookId, row]));

    expect(metadataByBookId.get(scenario.books.isbn.bookId)).toMatchObject({
      title: 'Imported ISBN Title',
      subtitle: 'Imported Subtitle',
      description: 'Long imported description',
      isbn10: '1234567890',
      isbn13: '9781111111111',
      publisher: 'Imported Publisher',
      publishedYear: 2021,
      language: 'en',
      pageCount: 321,
      seriesName: 'Series Prime',
      seriesIndex: 2.5,
      rating: 5,
      googleBooksId: 'google-101',
      goodreadsId: 'gr-101',
      amazonId: 'ASIN101',
      hardcoverId: 'hc-101',
      audibleId: 'aud-101',
      comicvineId: 'cv-101',
      durationSeconds: 11111,
      abridged: true,
      coverSource: 'custom',
    });
    expect(metadataByBookId.get(scenario.books.hash.bookId)).toMatchObject({
      title: 'Imported Hash Title',
      description: 'Hash description',
      subtitle: null,
      publishedYear: null,
      pageCount: null,
      rating: null,
      googleBooksId: null,
      durationSeconds: null,
    });
    expect(metadataByBookId.get(scenario.books.audio.bookId)).toMatchObject({
      title: 'Audio Path Match',
      description: 'Audio description',
      publisher: 'Audio Publisher',
      audibleId: 'audio-id-103',
      durationSeconds: 300,
      abridged: true,
      coverSource: 'custom',
    });
    expect(metadataByBookId.get(scenario.books.titleAuthor.bookId)?.title).toBe('Title Author Match');
    expect(metadataByBookId.get(scenario.books.duplicate.bookId)?.title).toBe('Duplicate Preferred');

    await expectContributorNames(ctx, scenario.books.isbn.bookId, 'author', ['Jane Primary', 'John Secondary']);
    await expectContributorNames(ctx, scenario.books.audio.bookId, 'author', ['Audio Author', 'Guest Author']);
    await expectContributorNames(ctx, scenario.books.titleAuthor.bookId, 'author', ['Unique Title Author']);
    await expectContributorNames(ctx, scenario.books.audio.bookId, 'narrator', ['Narrator Alpha', 'Narrator Beta']);

    expect(await loadNamesForBook(ctx, scenario.books.isbn.bookId, 'genre')).toEqual(['Adventure', 'Fantasy']);
    expect(await loadNamesForBook(ctx, scenario.books.isbn.bookId, 'tag')).toEqual(['Imported Tag 1', 'Imported Tag 2']);
    expect(await loadNamesForBook(ctx, scenario.books.hash.bookId, 'tag')).toEqual(['Hash Imported Tag']);

    const statusRows = await ctx.db.select().from(schema.userBookStatus);
    expect(statusRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookId: scenario.books.isbn.bookId,
          status: 'read',
          source: 'manual',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.bob.id,
          bookId: scenario.books.audio.bookId,
          status: 'reading',
          source: 'manual',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookId: scenario.books.duplicate.bookId,
          status: 'want_to_read',
          source: 'manual',
        }),
      ]),
    );
    expect(statusRows.some((row) => row.userId !== scenario.targetUsers.alice.id && row.userId !== scenario.targetUsers.bob.id)).toBe(false);

    const progressRows = await ctx.db.select().from(schema.readingProgress);
    expect(progressRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookFileId: scenario.books.isbn.primaryFileId,
          percentage: 33.3,
          cfi: 'epubcfi(/6/2[chap]!/4/1:0)',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookFileId: scenario.books.hash.primaryFileId,
          percentage: 22.4,
          pageNumber: 10,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.bob.id,
          bookFileId: scenario.books.audio.fileIds[1],
          percentage: 66,
          positionSeconds: 12.5,
        }),
      ]),
    );
    expect(progressRows).toHaveLength(3);

    const audioProgressRows = await ctx.db.select().from(schema.audiobookProgress);
    expect(audioProgressRows).toEqual([
      expect.objectContaining({
        userId: scenario.targetUsers.bob.id,
        bookId: scenario.books.audio.bookId,
        currentFileId: scenario.books.audio.fileIds[1],
        percentage: 66,
        positionSeconds: 12.5,
      }),
    ]);

    const bookmarks = await ctx.db.select().from(schema.bookmarks);
    expect(bookmarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookId: scenario.books.isbn.bookId,
          title: 'Chapter 1',
          cfi: 'epubcfi(/6/2[chap]!/4/1:0)',
          positionSeconds: null,
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.bob.id,
          bookId: scenario.books.audio.bookId,
          title: 'Imported bookmark',
          cfi: null,
          positionSeconds: 135,
        }),
      ]),
    );

    const annotations = await ctx.db.select().from(schema.annotations);
    expect(annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: scenario.targetUsers.alice.id,
          bookId: scenario.books.isbn.bookId,
          color: 'blue',
          style: 'underline',
          note: 'remember this',
          chapterTitle: 'Chapter One',
        }),
        expect.objectContaining({
          userId: scenario.targetUsers.bob.id,
          bookId: scenario.books.titleAuthor.bookId,
          color: 'yellow',
          style: 'highlight',
          note: null,
          chapterTitle: null,
        }),
      ]),
    );

    const importedCollections = await ctx.db.select().from(schema.collections).where(eq(schema.collections.userId, scenario.targetUsers.alice.id));
    expect(importedCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Favorites', description: 'Existing favorites collection' }),
        expect.objectContaining({
          name: 'Favorites (Booklore)',
          description: 'Imported from Booklore migration shelf: 501',
        }),
      ]),
    );

    const importedFavorites = importedCollections.find((row) => row.description === 'Imported from Booklore migration shelf: 501');
    expect(importedFavorites).toBeDefined();
    const importedCollectionBooks = await ctx.db
      .select()
      .from(schema.collectionBooks)
      .where(eq(schema.collectionBooks.collectionId, importedFavorites!.id));
    expect(importedCollectionBooks.map((row) => row.bookId).sort((left, right) => left - right)).toEqual(
      [scenario.books.isbn.bookId, scenario.books.titleAuthor.bookId].sort((left, right) => left - right),
    );

    const isbnCoverDir = coverDirectoryForBook(ctx, scenario.books.isbn.bookId);
    const audioCoverDir = coverDirectoryForBook(ctx, scenario.books.audio.bookId);
    await access(join(isbnCoverDir, 'cover_custom.jpg'));
    await access(join(isbnCoverDir, 'thumbnail.jpg'));
    await access(join(audioCoverDir, 'cover_custom.png'));
    await access(join(audioCoverDir, 'thumbnail.jpg'));

    const audioCoverBytes = await readFile(join(audioCoverDir, 'cover_custom.png'));
    expect(audioCoverBytes[0]).toBe(0x89);
    expect(audioCoverBytes[1]).toBe(0x50);

    await assertNoIntegrityViolations(ctx.db);
  });

  it('supports alternate Booklore schema variants and join-through file progress', async () => {
    const scenario = await seedCompatibilityScenario(ctx);

    const createdSource = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        name: 'Compatibility Booklore',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(createdSource.statusCode).toBe(201);

    const validatedSource = await apiJson<{ ok: boolean }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${createdSource.body.id}/validate`,
      token: ctx.adminToken,
    });
    expect(validatedSource.statusCode).toBe(200);
    expect(validatedSource.body.ok).toBe(true);

    const profile = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId: createdSource.body.id,
        name: 'Compatibility Profile',
        userMappings: [{ sourceUserId: '41', targetUserId: scenario.targetUser.id }],
        pathMappings: scenario.pathMappings,
      },
    });
    expect(profile.statusCode).toBe(201);

    const validatedMappings = await apiJson<{ persistedProfileId: number | null }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${createdSource.body.id}/path-mappings/validate`,
      token: ctx.adminToken,
      payload: {
        pathMappings: scenario.pathMappings,
      },
    });
    expect(validatedMappings.statusCode).toBe(201);
    expect(validatedMappings.body.persistedProfileId).toBe(profile.body.id);

    const dryRun = await apiJson<{ id: number; summary: { status: string; matchedBooks: number } }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/plans/dry-run',
      token: ctx.adminToken,
      payload: { profileId: profile.body.id },
    });
    expect(dryRun.statusCode).toBe(201);
    expect(dryRun.body.summary).toMatchObject({
      status: 'ready_for_live_run',
      matchedBooks: 1,
    });

    const startedRun = await apiJson<{ id: number; state: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: dryRun.body.id },
    });
    expect(startedRun.statusCode).toBe(201);
    expect(startedRun.body.state).toBe('running');

    await waitForMigrationToFinish(ctx, startedRun.body.id);

    const metadata = await ctx.db.query.bookMetadata.findFirst({
      where: eq(schema.bookMetadata.bookId, scenario.book.bookId),
    });
    expect(metadata).toMatchObject({
      title: 'Variant Imported Title',
      subtitle: 'Keep this subtitle',
      description: 'Variant imported description',
      isbn10: '0123456789',
      isbn13: '9780000000401',
      publisher: 'Variant Publisher',
      publishedYear: 2022,
      language: 'en',
      pageCount: 222,
      seriesName: 'Variant Series',
      seriesIndex: 1.25,
      rating: 4,
      googleBooksId: 'variant-google-id',
      durationSeconds: 987,
      abridged: false,
    });

    await expectContributorNames(ctx, scenario.book.bookId, 'author', ['Variant Author', 'Second Variant Author']);
    await expectContributorNames(ctx, scenario.book.bookId, 'narrator', ['Narrator Gamma', 'Narrator Delta']);

    const userStatus = await ctx.db.query.userBookStatus.findFirst({
      where: eq(schema.userBookStatus.bookId, scenario.book.bookId),
    });
    expect(userStatus).toMatchObject({
      userId: scenario.targetUser.id,
      status: 'on_hold',
      source: 'manual',
    });

    const readingProgress = await ctx.db.query.readingProgress.findFirst({
      where: eq(schema.readingProgress.bookFileId, scenario.book.primaryFileId),
    });
    expect(readingProgress).toMatchObject({
      userId: scenario.targetUser.id,
      percentage: 78,
      cfi: 'epubcfi(/6/10!/4/2:20)',
      pageNumber: 9,
      positionSeconds: 6.5,
    });

    const bookmarks = await ctx.db.select().from(schema.bookmarks).where(eq(schema.bookmarks.bookId, scenario.book.bookId));
    expect(bookmarks).toEqual([
      expect.objectContaining({
        userId: scenario.targetUser.id,
        title: 'Variant bookmark',
        cfi: 'epubcfi(/6/12!/4/2:1)',
        positionSeconds: 2.5,
      }),
    ]);
  });

  it('fails validation and source creation when required Booklore tables are missing', async () => {
    const connectionConfig = await seedMissingRequiredTablesScenario(ctx);

    const testedSource = await apiJson<{
      ok: boolean;
      missingTables: string[];
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources/test',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        connectionConfig,
      },
    });
    expect(testedSource.statusCode).toBe(201);
    expect(testedSource.body.ok).toBe(false);
    expect(testedSource.body.missingTables).toContain('book_file');

    const createdSource = await apiJson<{ message: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        name: 'Missing Tables',
        connectionConfig,
      },
    });
    expectError(createdSource, 400, 'Missing required tables');
  });

  it('runs safely with optional domains missing and records warnings plus skipped metrics', async () => {
    const scenario = await seedWarningsOnlyScenario(ctx);

    const testedSource = await apiJson<{
      ok: boolean;
      warnings: string[];
    }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources/test',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(testedSource.statusCode).toBe(201);
    expect(testedSource.body.ok).toBe(true);
    expect(testedSource.body.warnings).toEqual(
      expect.arrayContaining([
        'book_metadata table not found; metadata overlays will be limited',
        'author mapping tables not found; author migration disabled',
        'user_book_progress table not found; status migration disabled',
        'book_marks table not found; bookmark migration disabled',
        'mediaRootPath not configured; book cover/thumbnail import disabled',
      ]),
    );

    const source = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        name: 'Warnings Source',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(source.statusCode).toBe(201);

    const validatedSource = await apiJson<{ ok: boolean }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${source.body.id}/validate`,
      token: ctx.adminToken,
    });
    expect(validatedSource.statusCode).toBe(200);
    expect(validatedSource.body.ok).toBe(true);

    const profile = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId: source.body.id,
        name: 'Warnings Profile',
        userMappings: [{ sourceUserId: '91', targetUserId: scenario.targetUser.id }],
        pathMappings: [],
      },
    });
    expect(profile.statusCode).toBe(201);

    const dryRun = await apiJson<{ id: number; summary: { status: string; matchedBooks: number } }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/plans/dry-run',
      token: ctx.adminToken,
      payload: { profileId: profile.body.id },
    });
    expect(dryRun.statusCode).toBe(201);
    expect(dryRun.body.summary).toMatchObject({
      status: 'ready_for_live_run',
      matchedBooks: 1,
    });

    const startedRun = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: dryRun.body.id },
    });
    expect(startedRun.statusCode).toBe(201);

    const finished = await waitForMigrationToFinish(ctx, startedRun.body.id);
    const metricByKey = buildMetricMap(finished.report.metrics as MetricRow[]);

    expect(metricByKey.get('shared_overlays:book_metadata')).toMatchObject({
      processed: 1,
      imported: 0,
      skipped: 1,
    });
    expect(metricByKey.get('shared_overlays:book_authors')).toMatchObject({
      processed: 1,
      imported: 0,
      skipped: 1,
    });
    expect(metricByKey.get('book_covers:book_covers')).toMatchObject({
      processed: 1,
      imported: 0,
      skipped: 1,
      unresolved: 0,
    });
    expect(metricByKey.get('user_state:user_book_status')).toMatchObject({
      processed: 0,
      imported: 0,
      skipped: 0,
      unresolved: 0,
    });

    expect(await ctx.db.select().from(schema.userBookStatus)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.bookmarks)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.annotations)).toHaveLength(0);
  });

  it('invalidates dry-run plans after the source is revalidated', async () => {
    const scenario = await seedWarningsOnlyScenario(ctx);

    const source = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        name: 'Stale Plan Source',
        connectionConfig: scenario.connectionConfig,
      },
    });
    expect(source.statusCode).toBe(201);

    const profile = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/profiles',
      token: ctx.adminToken,
      payload: {
        sourceId: source.body.id,
        name: 'Stale Plan Profile',
        userMappings: [{ sourceUserId: '91', targetUserId: scenario.targetUser.id }],
      },
    });
    expect(profile.statusCode).toBe(201);

    const dryRun = await apiJson<{ id: number }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/plans/dry-run',
      token: ctx.adminToken,
      payload: { profileId: profile.body.id },
    });
    expect(dryRun.statusCode).toBe(201);

    const revalidated = await apiJson<{ ok: boolean }>(ctx, {
      method: 'POST',
      url: `/api/v1/migration/sources/${source.body.id}/validate`,
      token: ctx.adminToken,
    });
    expect(revalidated.statusCode).toBe(200);
    expect(revalidated.body.ok).toBe(true);

    const startedRun = await apiJson<{ message: string }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/runs/live',
      token: ctx.adminToken,
      payload: { planArtifactId: dryRun.body.id },
    });
    expectError(startedRun, 404, 'Migration plan artifact not found');
  });

  it('enforces authz and DTO validation for migration endpoints', async () => {
    const anonymous = await apiJson<{ message: string }>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/state',
    });
    expectError(anonymous, 401, 'Unauthorized');

    const regularUser = await createUser(ctx, { login: true });
    const forbidden = await apiJson<{ message: string }>(ctx, {
      method: 'GET',
      url: '/api/v1/migration/state',
      token: regularUser.accessToken,
    });
    expectError(forbidden, 403, 'Missing permission');

    const invalidDto = await apiJson<{ message: string | string[] }>(ctx, {
      method: 'POST',
      url: '/api/v1/migration/sources/test',
      token: ctx.adminToken,
      payload: {
        type: 'booklore',
        connectionConfig: buildBookloreConnectionConfig(ctx),
        bogus: true,
      },
    });
    expect(invalidDto.statusCode).toBe(400);
    expect(JSON.stringify(invalidDto.body)).toContain('bogus');
  });
});

function buildMetricMap(metrics: MetricRow[]): Map<string, MetricRow> {
  return new Map(metrics.map((metric) => [`${metric.stage}:${metric.entityType}`, metric]));
}

function expectError<T>(response: { statusCode: number; body: T }, statusCode: number, messageFragment: string): void {
  expect(response.statusCode).toBe(statusCode);
  expect(JSON.stringify(response.body)).toContain(messageFragment);
}

async function expectContributorNames(
  ctx: MigrationBookloreE2EContext,
  bookId: number,
  type: 'author' | 'narrator',
  expectedNames: string[],
): Promise<void> {
  const names = await loadNamesForBook(ctx, bookId, type);
  expect(names).toEqual(expectedNames);
}

async function loadNamesForBook(ctx: MigrationBookloreE2EContext, bookId: number, type: 'author' | 'narrator' | 'genre' | 'tag'): Promise<string[]> {
  if (type === 'author') {
    const rows = await ctx.db
      .select({
        name: schema.authors.name,
        displayOrder: schema.bookAuthors.displayOrder,
      })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .orderBy(schema.bookAuthors.displayOrder);
    return rows.map((row) => row.name);
  }

  if (type === 'narrator') {
    const rows = await ctx.db
      .select({
        name: schema.narrators.name,
        displayOrder: schema.bookNarrators.displayOrder,
      })
      .from(schema.bookNarrators)
      .innerJoin(schema.narrators, eq(schema.narrators.id, schema.bookNarrators.narratorId))
      .where(eq(schema.bookNarrators.bookId, bookId))
      .orderBy(schema.bookNarrators.displayOrder);
    return rows.map((row) => row.name);
  }

  if (type === 'genre') {
    const rows = await ctx.db
      .select({
        name: schema.genres.name,
      })
      .from(schema.bookGenres)
      .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
      .where(eq(schema.bookGenres.bookId, bookId))
      .orderBy(schema.genres.name);
    return rows.map((row) => row.name);
  }

  const rows = await ctx.db
    .select({
      name: schema.tags.name,
    })
    .from(schema.bookTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
    .where(eq(schema.bookTags.bookId, bookId))
    .orderBy(schema.tags.name);
  return rows.map((row) => row.name);
}
