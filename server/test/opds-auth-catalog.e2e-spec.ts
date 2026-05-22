import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';
import { ConfigService } from '@nestjs/config';

import { createCoverToken } from '../src/modules/opds/opds-auth.guard';
import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/opds/opds-fixture-builder';
import {
  authHeader,
  basicAuth,
  closeOpdsE2EContext,
  createBookCoverArtifacts,
  createLibraryWithFolder,
  createOpdsE2EContext,
  createOpdsUserCredential,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  replaceUserPermissions,
  setSetting,
  setUserActive,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type OpdsE2EContext,
  type TestUserSession,
} from './e2e/opds/opds-harness';

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

interface OpdsCredentials {
  username: string;
  password: string;
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'opds-auth-catalog-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      },
      null,
      2,
    ),
  );
}

describe('OPDS auth and catalog (e2e)', { timeout: 120_000 }, () => {
  let ctx!: OpdsE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  let owner!: TestUserSession;
  let intruder!: TestUserSession;
  let disabledParent!: TestUserSession;
  let revokedParent!: TestUserSession;
  let noOpdsPermissionUser!: TestUserSession;

  let visibleLibrary!: CreatedLibrary;
  let hiddenLibrary!: CreatedLibrary;

  let visibleBookAlpha!: LocatedBookFile;
  let visibleBookBeta!: LocatedBookFile;
  let hiddenBook!: LocatedBookFile;

  let ownerCredentials!: OpdsCredentials;
  let disabledCredentials!: OpdsCredentials;
  let revokedCredentials!: OpdsCredentials;

  let ownerCollectionId!: number;
  let foreignCollectionId!: number;
  let ownerSmartScopeId!: number;
  let foreignSmartScopeId!: number;

  let visibleAuthorName!: string;
  let hiddenAuthorName!: string;
  let visibleSeriesName!: string;
  let hiddenSeriesName!: string;

  beforeAll(async () => {
    ctx = await createOpdsE2EContext();

    visibleLibrary = await createLibraryWithFolder(ctx, { name: `opds-visible-library-${randomUUID()}` });
    hiddenLibrary = await createLibraryWithFolder(ctx, { name: `opds-hidden-library-${randomUUID()}` });

    const visibleAlphaPath = await createEpubFixture(visibleLibrary.folderPath, 'visible-alpha.epub', { title: 'Visible Alpha' });
    const visibleBetaPath = await createEpubFixture(visibleLibrary.folderPath, 'visible-beta.epub', { title: 'Visible Beta' });
    const hiddenGammaPath = await createEpubFixture(hiddenLibrary.folderPath, 'hidden-gamma.epub', { title: 'Hidden Gamma' });

    await triggerAndWaitForLibraryScan(ctx, visibleLibrary.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hiddenLibrary.libraryId);

    visibleBookAlpha = await locateBookByAbsolutePath(ctx, visibleAlphaPath);
    visibleBookBeta = await locateBookByAbsolutePath(ctx, visibleBetaPath);
    hiddenBook = await locateBookByAbsolutePath(ctx, hiddenGammaPath);

    await createBookCoverArtifacts(ctx, visibleBookAlpha.bookId);
    await createBookCoverArtifacts(ctx, visibleBookBeta.bookId);
    await createBookCoverArtifacts(ctx, hiddenBook.bookId);

    visibleAuthorName = `Visible Author ${randomUUID().slice(0, 8)}`;
    hiddenAuthorName = `Hidden Author ${randomUUID().slice(0, 8)}`;
    visibleSeriesName = `Visible Series ${randomUUID().slice(0, 8)}`;
    hiddenSeriesName = `Hidden Series ${randomUUID().slice(0, 8)}`;

    await seedBookMetadata(visibleBookAlpha.bookId, 'Visible Alpha', visibleSeriesName, 1, '9780141187761');
    await seedBookMetadata(visibleBookBeta.bookId, 'Visible Beta', visibleSeriesName, 2);
    await seedBookMetadata(hiddenBook.bookId, 'Hidden Gamma', hiddenSeriesName, 1, '9780300000000');

    await linkBookAuthor(visibleBookAlpha.bookId, visibleAuthorName);
    await linkBookAuthor(visibleBookBeta.bookId, visibleAuthorName);
    await linkBookAuthor(hiddenBook.bookId, hiddenAuthorName);

    owner = await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] });
    intruder = await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] });
    disabledParent = await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] });
    revokedParent = await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] });
    noOpdsPermissionUser = await createUserAndLogin(ctx);

    await grantLibraryAccess(ctx, owner.userId, visibleLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, intruder.userId, visibleLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, disabledParent.userId, visibleLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, revokedParent.userId, visibleLibrary.libraryId, 'viewer');

    const ownerOpds = await createOpdsUserCredential(ctx, {
      userId: owner.userId,
      username: `opds-owner-${randomUUID().slice(0, 8)}`,
      password: 'OwnerOpdsPass123',
    });
    const disabledOpds = await createOpdsUserCredential(ctx, {
      userId: disabledParent.userId,
      username: `opds-disabled-${randomUUID().slice(0, 8)}`,
      password: 'DisabledOpdsPass123',
    });
    const revokedOpds = await createOpdsUserCredential(ctx, {
      userId: revokedParent.userId,
      username: `opds-revoked-${randomUUID().slice(0, 8)}`,
      password: 'RevokedOpdsPass123',
    });

    ownerCredentials = { username: ownerOpds.row.username, password: ownerOpds.password };
    disabledCredentials = { username: disabledOpds.row.username, password: disabledOpds.password };
    revokedCredentials = { username: revokedOpds.row.username, password: revokedOpds.password };

    await setUserActive(ctx, disabledParent.userId, false);
    await replaceUserPermissions(ctx, revokedParent.userId, []);

    const [ownerCollection] = await ctx.db
      .insert(schema.collections)
      .values({
        userId: owner.userId,
        name: `owner-collection-${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: schema.collections.id });
    ownerCollectionId = ownerCollection.id;

    await ctx.db.insert(schema.collectionBooks).values([
      { collectionId: ownerCollectionId, bookId: visibleBookAlpha.bookId },
      { collectionId: ownerCollectionId, bookId: visibleBookBeta.bookId },
    ]);

    const [foreignCollection] = await ctx.db
      .insert(schema.collections)
      .values({
        userId: intruder.userId,
        name: `foreign-collection-${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: schema.collections.id });
    foreignCollectionId = foreignCollection.id;

    await ctx.db.insert(schema.collectionBooks).values({ collectionId: foreignCollectionId, bookId: visibleBookAlpha.bookId });

    const [ownerSmartScope] = await ctx.db
      .insert(schema.smartScopes)
      .values({
        userId: owner.userId,
        name: `owner-smartScope-${randomUUID().slice(0, 8)}`,
        filter: null,
        isPublic: false,
      })
      .returning({ id: schema.smartScopes.id });
    ownerSmartScopeId = ownerSmartScope.id;

    const [foreignSmartScope] = await ctx.db
      .insert(schema.smartScopes)
      .values({
        userId: intruder.userId,
        name: `foreign-smartScope-${randomUUID().slice(0, 8)}`,
        filter: null,
        isPublic: false,
      })
      .returning({ id: schema.smartScopes.id });
    foreignSmartScopeId = foreignSmartScope.id;

    await setSetting(ctx, 'opds_enabled', 'true');
  }, 120_000);

  beforeEach(async () => {
    scenarioStartedAt = Date.now();
    await setSetting(ctx, 'opds_enabled', 'true');
  });

  afterEach((taskContext) => {
    const result = taskContext.task.result;
    if (!result) return;

    const state = result.state === 'pass' ? 'passed' : 'failed';
    const error = result.errors?.[0]?.message;
    scenarioResults.push({
      id: taskContext.task.name,
      status: state,
      durationMs: Math.max(0, Date.now() - scenarioStartedAt),
      ...(error ? { error } : {}),
    });
  });

  afterAll(async () => {
    await writeScenarioReport(scenarioResults);
    if (ctx) {
      await closeOpdsE2EContext(ctx);
    }
  });

  describe('opds-users lifecycle contract', () => {
    it('supports create list update delete and enforces owner boundaries', async () => {
      const username = `opds-lifecycle-${randomUUID().slice(0, 8)}`;
      const createResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/opds-users',
        headers: authHeader(owner.accessToken),
        payload: {
          username,
          password: 'LifecyclePass123',
          sortOrder: 'recent',
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json() as { id: number; username: string; sortOrder: string };
      expect(created).toMatchObject({ username, sortOrder: 'recent' });

      const listResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds-users',
        headers: authHeader(owner.accessToken),
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, username })]));

      const updateResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/opds-users/${created.id}`,
        headers: authHeader(owner.accessToken),
        payload: { sortOrder: 'title_asc' },
      });
      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json()).toEqual(expect.objectContaining({ id: created.id, sortOrder: 'title_asc' }));

      const foreignUpdateResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/opds-users/${created.id}`,
        headers: authHeader(intruder.accessToken),
        payload: { sortOrder: 'title_desc' },
      });
      expectError(foreignUpdateResponse, 403, 'Not the owner');

      const foreignDeleteResponse = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/opds-users/${created.id}`,
        headers: authHeader(intruder.accessToken),
      });
      expectError(foreignDeleteResponse, 403, 'Not the owner');

      const deleteResponse = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/opds-users/${created.id}`,
        headers: authHeader(owner.accessToken),
      });
      expect(deleteResponse.statusCode).toBe(204);

      const afterDeleteListResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds-users',
        headers: authHeader(owner.accessToken),
      });
      expect(afterDeleteListResponse.statusCode).toBe(200);
      expect(afterDeleteListResponse.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    });

    it('requires opds_access permission for opds-users management', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds-users',
        headers: authHeader(noOpdsPermissionUser.accessToken),
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns conflict for duplicate OPDS username', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/opds-users',
        headers: authHeader(owner.accessToken),
        payload: {
          username: ownerCredentials.username,
          password: 'DuplicatePass123',
        },
      });
      expectError(response, 409, 'already exists');
    });
  });

  describe('basic auth and guard behavior', () => {
    it('rejects all OPDS requests when OPDS is disabled', async () => {
      await setSetting(ctx, 'opds_enabled', 'false');

      const response = await opdsGet('/api/v1/opds/libraries', ownerCredentials);
      expectError(response, 403, 'disabled');
    });

    it('requires Basic auth and returns WWW-Authenticate challenge', async () => {
      const response = await opdsGet('/api/v1/opds/libraries');
      expectError(response, 401, 'Basic authentication required');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('rejects invalid Basic credentials with WWW-Authenticate challenge', async () => {
      const response = await opdsGet('/api/v1/opds/libraries', {
        username: ownerCredentials.username,
        password: 'WrongPassword123',
      });
      expectError(response, 401, 'Invalid credentials');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('rejects OPDS auth for disabled parent users', async () => {
      const response = await opdsGet('/api/v1/opds/libraries', disabledCredentials);
      expectError(response, 401, 'disabled');
    });

    it('rejects OPDS auth when parent opds_access is revoked', async () => {
      const response = await opdsGet('/api/v1/opds/libraries', revokedCredentials);
      expectError(response, 403, 'OPDS access revoked');
    });

    it('accepts valid Basic credentials and serves OPDS XML', async () => {
      const response = await opdsGet('/api/v1/opds', ownerCredentials);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/atom+xml;profile=opds-catalog');
    });

    it('rejects token auth on non-image routes with Basic challenge', async () => {
      const jwtSecret = ctx.app.get(ConfigService).getOrThrow<string>('auth.jwtSecret');
      const token = createCoverToken(owner.userId, jwtSecret);

      const response = await opdsGet(`/api/v1/opds/catalog?t=${token}`);
      expectError(response, 401, 'Basic authentication required');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('rejects invalid token auth on image routes', async () => {
      const response = await opdsGet(`/api/v1/opds/${visibleBookAlpha.bookId}/cover?t=not-a-valid-token`);
      expectError(response, 401, 'Invalid token');
    });
  });

  describe('catalog/feed contract', () => {
    it('serves root navigation and search description with expected MIME and links', async () => {
      const rootResponse = await opdsGet('/api/v1/opds', ownerCredentials);
      expect(rootResponse.statusCode).toBe(200);
      expect(rootResponse.headers['content-type']).toContain('application/atom+xml;profile=opds-catalog');
      expect(rootResponse.body).toContain('/api/v1/opds/catalog');
      expect(rootResponse.body).toContain('/api/v1/opds/recent');
      expect(rootResponse.body).toContain('/api/v1/opds/surprise');
      expect(rootResponse.body).toContain('/api/v1/opds/libraries');
      expect(rootResponse.body).toContain('/api/v1/opds/search.opds');

      const searchResponse = await opdsGet('/api/v1/opds/search.opds', ownerCredentials);
      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.headers['content-type']).toContain('application/opensearchdescription+xml');
      expect(searchResponse.body).toContain('/api/v1/opds/catalog?q={searchTerms}');
    });

    it('scopes libraries, collections, smartScopes, authors, and series to the authenticated parent user', async () => {
      const librariesResponse = await opdsGet('/api/v1/opds/libraries', ownerCredentials);
      expect(librariesResponse.statusCode).toBe(200);
      expect(librariesResponse.body).toContain(`libraryId=${visibleLibrary.libraryId}`);
      expect(librariesResponse.body).not.toContain(`libraryId=${hiddenLibrary.libraryId}`);

      const collectionsResponse = await opdsGet('/api/v1/opds/collections', ownerCredentials);
      expect(collectionsResponse.statusCode).toBe(200);
      expect(collectionsResponse.body).toContain(`collectionId=${ownerCollectionId}`);
      expect(collectionsResponse.body).not.toContain(`collectionId=${foreignCollectionId}`);

      const smartScopesResponse = await opdsGet('/api/v1/opds/smart-scopes', ownerCredentials);
      expect(smartScopesResponse.statusCode).toBe(200);
      expect(smartScopesResponse.body).toContain(`smartScopeId=${ownerSmartScopeId}`);
      expect(smartScopesResponse.body).not.toContain(`smartScopeId=${foreignSmartScopeId}`);

      const authorsResponse = await opdsGet('/api/v1/opds/authors', ownerCredentials);
      expect(authorsResponse.statusCode).toBe(200);
      expect(authorsResponse.body).toContain(visibleAuthorName);
      expect(authorsResponse.body).not.toContain(hiddenAuthorName);

      const seriesResponse = await opdsGet('/api/v1/opds/series', ownerCredentials);
      expect(seriesResponse.statusCode).toBe(200);
      expect(seriesResponse.body).toContain(visibleSeriesName);
      expect(seriesResponse.body).not.toContain(hiddenSeriesName);
    });

    it('enforces catalog pagination, filters, and strict query validation', async () => {
      const page1Response = await opdsGet('/api/v1/opds/catalog?page=1&size=1', ownerCredentials);
      expect(page1Response.statusCode).toBe(200);
      expect(page1Response.headers['content-type']).toContain('application/atom+xml;profile=opds-catalog');
      expect(page1Response.body).toContain('<opensearch:totalResults>2</opensearch:totalResults>');
      expect(page1Response.body).toContain('rel="next"');
      expect(page1Response.body).not.toContain('rel="previous"');

      const page2Response = await opdsGet('/api/v1/opds/catalog?page=2&size=1', ownerCredentials);
      expect(page2Response.statusCode).toBe(200);
      expect(page2Response.body).toContain('rel="previous"');

      const ownerLibraryResponse = await opdsGet(`/api/v1/opds/catalog?libraryId=${visibleLibrary.libraryId}`, ownerCredentials);
      expect(ownerLibraryResponse.statusCode).toBe(200);
      expect(ownerLibraryResponse.body).toContain('Visible Alpha');

      const forbiddenLibraryResponse = await opdsGet(`/api/v1/opds/catalog?libraryId=${hiddenLibrary.libraryId}`, ownerCredentials);
      expectError(forbiddenLibraryResponse, 403, 'No access to this library');

      const invalidLibraryFilterResponse = await opdsGet('/api/v1/opds/catalog?libraryId=abc', ownerCredentials);
      expectError(invalidLibraryFilterResponse, 400, 'libraryId must be a positive integer');

      const invalidCollectionFilterResponse = await opdsGet('/api/v1/opds/catalog?collectionId=oops', ownerCredentials);
      expectError(invalidCollectionFilterResponse, 400, 'collectionId must be a positive integer');

      const invalidSmartScopeFilterResponse = await opdsGet('/api/v1/opds/catalog?smartScopeId=bad', ownerCredentials);
      expectError(invalidSmartScopeFilterResponse, 400, 'smartScopeId must be a positive integer');

      const foreignCollectionResponse = await opdsGet(`/api/v1/opds/catalog?collectionId=${foreignCollectionId}`, ownerCredentials);
      expectError(foreignCollectionResponse, 403, 'No access to this collection');

      const ownerCollectionResponse = await opdsGet(`/api/v1/opds/catalog?collectionId=${ownerCollectionId}`, ownerCredentials);
      expect(ownerCollectionResponse.statusCode).toBe(200);
      expect(ownerCollectionResponse.body).toContain('Visible Alpha');

      const ownerSmartScopeResponse = await opdsGet(`/api/v1/opds/catalog?smartScopeId=${ownerSmartScopeId}`, ownerCredentials);
      expect(ownerSmartScopeResponse.statusCode).toBe(200);
      expect(ownerSmartScopeResponse.body).toContain('<opensearch:totalResults>2</opensearch:totalResults>');

      const foreignSmartScopeResponse = await opdsGet(`/api/v1/opds/catalog?smartScopeId=${foreignSmartScopeId}`, ownerCredentials);
      expect(foreignSmartScopeResponse.statusCode).toBe(200);
      expect(foreignSmartScopeResponse.body).toContain('<opensearch:totalResults>0</opensearch:totalResults>');

      const searchResponse = await opdsGet('/api/v1/opds/catalog?q=Visible Alpha', ownerCredentials);
      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.body).toContain('Visible Alpha');
      expect(searchResponse.body).not.toContain('Visible Beta');

      const authorSearchResponse = await opdsGet(`/api/v1/opds/catalog?q=${encodeURIComponent(visibleAuthorName)}`, ownerCredentials);
      expect(authorSearchResponse.statusCode).toBe(200);
      expect(authorSearchResponse.body).toContain('Visible Alpha');
      expect(authorSearchResponse.body).toContain('Visible Beta');
      expect(authorSearchResponse.body).not.toContain('Hidden Gamma');

      const seriesSearchResponse = await opdsGet(`/api/v1/opds/catalog?q=${encodeURIComponent(visibleSeriesName)}`, ownerCredentials);
      expect(seriesSearchResponse.statusCode).toBe(200);
      expect(seriesSearchResponse.body).toContain('Visible Alpha');
      expect(seriesSearchResponse.body).toContain('Visible Beta');
      expect(seriesSearchResponse.body).not.toContain('Hidden Gamma');

      const isbnSearchResponse = await opdsGet('/api/v1/opds/catalog?q=978-0%20141187761', ownerCredentials);
      expect(isbnSearchResponse.statusCode).toBe(200);
      expect(isbnSearchResponse.body).toContain('Visible Alpha');
      expect(isbnSearchResponse.body).not.toContain('Visible Beta');
      expect(isbnSearchResponse.body).not.toContain('Hidden Gamma');
    });
  });

  describe('tokenized image access and download behavior', () => {
    it('allows feed-issued token access for cover and thumbnail with ETag handling', async () => {
      const catalogResponse = await opdsGet('/api/v1/opds/catalog?page=1&size=10', ownerCredentials);
      expect(catalogResponse.statusCode).toBe(200);
      const coverToken = extractCoverToken(catalogResponse.body, visibleBookAlpha.bookId);

      const coverResponse = await opdsGet(`/api/v1/opds/${visibleBookAlpha.bookId}/cover?t=${encodeURIComponent(coverToken)}`);
      expect(coverResponse.statusCode).toBe(200);
      expect(coverResponse.headers['content-type']).toContain('image/jpeg');
      expect(coverResponse.headers.etag).toBeTruthy();

      const notModifiedCoverResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/opds/${visibleBookAlpha.bookId}/cover?t=${encodeURIComponent(coverToken)}`,
        headers: {
          'if-none-match': String(coverResponse.headers.etag),
        },
      });
      expect(notModifiedCoverResponse.statusCode).toBe(304);

      const thumbnailResponse = await opdsGet(`/api/v1/opds/${visibleBookAlpha.bookId}/thumbnail?t=${encodeURIComponent(coverToken)}`);
      expect(thumbnailResponse.statusCode).toBe(200);
      expect(thumbnailResponse.headers['content-type']).toContain('image/jpeg');
      expect(thumbnailResponse.headers.etag).toBeTruthy();
    });

    it('keeps tokenized image access scoped to the parent user library access', async () => {
      const catalogResponse = await opdsGet('/api/v1/opds/catalog?page=1&size=10', ownerCredentials);
      expect(catalogResponse.statusCode).toBe(200);
      const coverToken = extractCoverToken(catalogResponse.body, visibleBookAlpha.bookId);

      const hiddenCoverResponse = await opdsGet(`/api/v1/opds/${hiddenBook.bookId}/cover?t=${encodeURIComponent(coverToken)}`);
      expectError(hiddenCoverResponse, 403, 'No access to this book');
    });

    it('requires Basic auth for downloads and enforces file/book access boundaries', async () => {
      const catalogResponse = await opdsGet('/api/v1/opds/catalog?page=1&size=10', ownerCredentials);
      expect(catalogResponse.statusCode).toBe(200);
      const coverToken = extractCoverToken(catalogResponse.body, visibleBookAlpha.bookId);

      const tokenDownloadResponse = await opdsGet(`/api/v1/opds/${visibleBookAlpha.bookId}/download?t=${encodeURIComponent(coverToken)}`);
      expectError(tokenDownloadResponse, 401, 'Basic authentication required');
      expect(tokenDownloadResponse.headers['www-authenticate']).toContain('Basic realm=');

      const validDownloadResponse = await opdsGet(
        `/api/v1/opds/${visibleBookAlpha.bookId}/download?fileId=${visibleBookAlpha.bookFileId}`,
        ownerCredentials,
      );
      expect(validDownloadResponse.statusCode).toBe(200);
      expect(validDownloadResponse.headers['content-type']).toContain('application/epub+zip');
      expect(validDownloadResponse.headers['content-disposition']).toContain('attachment;');

      const badFileIdResponse = await opdsGet(`/api/v1/opds/${visibleBookAlpha.bookId}/download?fileId=999999`, ownerCredentials);
      expectError(badFileIdResponse, 404, 'File not found');

      const forbiddenBookDownloadResponse = await opdsGet(
        `/api/v1/opds/${hiddenBook.bookId}/download?fileId=${hiddenBook.bookFileId}`,
        ownerCredentials,
      );
      expectError(forbiddenBookDownloadResponse, 403, 'No access to this book');
    });
  });

  async function seedBookMetadata(bookId: number, title: string, seriesName: string, seriesIndex: number, isbn13?: string): Promise<void> {
    const values = { bookId, title, seriesName, seriesIndex, ...(isbn13 !== undefined ? { isbn13 } : {}) };
    const set = { title, seriesName, seriesIndex, ...(isbn13 !== undefined ? { isbn13 } : {}) };

    await ctx.db.insert(schema.bookMetadata).values(values).onConflictDoUpdate({
      target: schema.bookMetadata.bookId,
      set,
    });
  }

  async function linkBookAuthor(bookId: number, authorName: string): Promise<void> {
    const inserted = await ctx.db.insert(schema.authors).values({ name: authorName }).onConflictDoNothing().returning({ id: schema.authors.id });

    let authorId = inserted[0]?.id;
    if (!authorId) {
      const [existing] = await ctx.db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.name, authorName)).limit(1);
      if (!existing) throw new Error(`Author lookup failed for ${authorName}`);
      authorId = existing.id;
    }

    await ctx.db.insert(schema.bookAuthors).values({ bookId, authorId, displayOrder: 0 }).onConflictDoNothing();
  }

  async function opdsGet(path: string, credentials?: OpdsCredentials) {
    return ctx.app.inject({
      method: 'GET',
      url: path,
      headers: credentials ? { authorization: basicAuth(credentials.username, credentials.password) } : undefined,
    });
  }

  function extractCoverToken(feedXml: string, bookId: number): string {
    const tokenMatch = feedXml.match(new RegExp(`/api/v1/opds/${bookId}/cover\\?t=([^"&<]+)`));
    if (!tokenMatch?.[1]) {
      throw new Error(`Expected to find feed-issued cover token for book ${bookId}`);
    }
    return decodeURIComponent(tokenMatch[1]);
  }

  function expectError(response: Awaited<ReturnType<OpdsE2EContext['app']['inject']>>, statusCode: number, messageFragment: string): void {
    expect(response.statusCode).toBe(statusCode);
    const body = parseBody(response);
    if (body && typeof body === 'object') {
      expect(body).toEqual(
        expect.objectContaining({
          statusCode,
        }),
      );
    }
    expect(extractMessage(response)).toContain(messageFragment);
  }

  function parseBody(response: Awaited<ReturnType<OpdsE2EContext['app']['inject']>>): Record<string, unknown> | null {
    try {
      return response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function extractMessage(response: Awaited<ReturnType<OpdsE2EContext['app']['inject']>>): string {
    const body = parseBody(response);
    if (!body) return response.body;
    const message = body.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === 'string').join('; ');
    }
    return '';
  }
});
