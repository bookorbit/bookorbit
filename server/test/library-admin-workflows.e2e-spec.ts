import { randomUUID } from 'crypto';
import { access, mkdir, readFile } from 'fs/promises';
import { basename, join } from 'path';

import { and, eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { waitForCondition, waitForScanCompletion } from './e2e/app-harness';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  uploadLibraryFile,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';
import { createEpubFixture, writeFixtureFile } from './e2e/authorization-matrix/authorization-matrix-fixture-builder';

type InjectResponse = Awaited<ReturnType<AuthorizationMatrixE2EContext['app']['inject']>>;

const SCENARIO_TIMEOUT_MS = 120_000;

function responseMessage(response: { message?: string | string[] }): string {
  if (Array.isArray(response.message)) return response.message.join(' ');
  return String(response.message ?? '');
}

function expectError(response: InjectResponse, status: number, messageFragment?: string): void {
  expect(response.statusCode).toBe(status);
  if (!messageFragment) return;
  expect(responseMessage(response.json() as { message?: string | string[] })).toContain(messageFragment);
}

function buildMultipartBody(file?: { fileName: string; content: Buffer; contentType?: string }): { body: Buffer; boundary: string } {
  const boundary = `----bookorbit-library-admin-${randomUUID()}`;
  if (!file) {
    return {
      boundary,
      body: Buffer.from(`--${boundary}--\r\n`, 'utf8'),
    };
  }

  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.fileName}"\r\nContent-Type: ${
      file.contentType ?? 'application/octet-stream'
    }\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    body: Buffer.concat([preamble, file.content, closing]),
  };
}

async function uploadLibraryFileWithRawQuery(
  ctx: AuthorizationMatrixE2EContext,
  input: {
    token: string;
    libraryId: number;
    query?: string;
    file?: {
      fileName: string;
      content: Buffer;
      contentType?: string;
    };
  },
): Promise<InjectResponse> {
  const { body, boundary } = buildMultipartBody(input.file);
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/libraries/${input.libraryId}/upload${input.query ?? ''}`,
    headers: {
      ...authHeader(input.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
}

async function createUploadFixtureBytes(ctx: AuthorizationMatrixE2EContext, relativePath: string, title: string): Promise<Buffer> {
  const absolutePath = await createEpubFixture(ctx.fixture.rootPath, relativePath, { title });
  return readFile(absolutePath);
}

async function waitForNoRunningScans(ctx: AuthorizationMatrixE2EContext, libraryId: number): Promise<void> {
  await waitForCondition(async () => {
    const running = await ctx.db
      .select({ id: schema.scanJobs.id })
      .from(schema.scanJobs)
      .where(and(eq(schema.scanJobs.libraryId, libraryId), eq(schema.scanJobs.status, 'running')));
    expect(running).toHaveLength(0);
  }, 15_000);
}

async function startLibraryScanAs(
  ctx: AuthorizationMatrixE2EContext,
  token: string,
  libraryId: number,
): Promise<typeof schema.scanJobs.$inferSelect> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/scanner/libraries/${libraryId}/scan`,
    headers: authHeader(token),
  });
  expect(response.statusCode).toBe(202);

  const body = response.json() as { jobId?: number };
  expect(body.jobId).toEqual(expect.any(Number));
  return waitForScanCompletion(ctx.db, body.jobId!, 45_000);
}

async function waitForCoverRefreshCalls(ctx: AuthorizationMatrixE2EContext, expectedCount: number): Promise<Array<[number, string, string]>> {
  await waitForCondition(() => {
    expect(ctx.metadataMock.refreshCoverForBook).toHaveBeenCalledTimes(expectedCount);
  }, 10_000);

  return ctx.metadataMock.refreshCoverForBook.mock.calls as Array<[number, string, string]>;
}

async function createLibraryViaApi(
  ctx: AuthorizationMatrixE2EContext,
  token: string,
  input?: Partial<{
    name: string;
    folders: string[];
    icon: string;
    watch: boolean;
    allowedFormats: string[];
    organizationMode: 'book_per_file' | 'book_per_folder';
    excludePatterns: string[];
    readingThreshold: number;
    markAsFinishedPercentComplete: number;
    fileWriteEnabled: boolean;
  }>,
): Promise<{
  response: InjectResponse;
  body: {
    id: number;
    name: string;
    folders: Array<{ id: number; path: string }>;
  } & Record<string, unknown>;
}> {
  const libraryFolderPath = input?.folders?.[0] ?? join(ctx.fixture.booksPath, `api-library-${randomUUID()}`);
  await mkdir(libraryFolderPath, { recursive: true });

  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/libraries',
    headers: authHeader(token),
    payload: {
      name: input?.name ?? `Library Admin ${randomUUID()}`,
      icon: input?.icon ?? 'library',
      folders: [libraryFolderPath],
      watch: input?.watch ?? false,
      allowedFormats: input?.allowedFormats ?? ['epub'],
      organizationMode: input?.organizationMode ?? 'book_per_file',
      excludePatterns: input?.excludePatterns ?? ['*.tmp'],
      readingThreshold: input?.readingThreshold ?? 0.4,
      markAsFinishedPercentComplete: input?.markAsFinishedPercentComplete ?? 95,
      fileWriteEnabled: input?.fileWriteEnabled ?? false,
    },
  });
  expect(response.statusCode).toBe(201);

  return {
    response,
    body: response.json() as {
      id: number;
      name: string;
      folders: Array<{ id: number; path: string }>;
    } & Record<string, unknown>,
  };
}

describe('Library admin workflows (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let manager!: TestUserSession;
  let scopedUser!: TestUserSession;
  let uploadOnlyUser!: TestUserSession;
  let noPermissionUser!: TestUserSession;

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    manager = await createUserAndLogin(ctx, {
      permissions: [Permission.ManageLibraries, Permission.LibraryUpload],
    });
    scopedUser = await createUserAndLogin(ctx);
    uploadOnlyUser = await createUserAndLogin(ctx, {
      permissions: [Permission.LibraryUpload],
    });
    noPermissionUser = await createUserAndLogin(ctx);
  });

  beforeEach(() => {
    ctx.metadataMock.extractAndSave.mockClear();
    ctx.metadataMock.refreshCoverForBook.mockClear();
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  describe('path and prescan', () => {
    it('lists valid directories, hides blocked or hidden entries, and returns prescan details for valid, overlapping, and missing paths', async () => {
      const overlapLibraryName = `library-overlap-${randomUUID()}`;
      const overlapLibrary = await createLibraryWithFolder(ctx, { name: overlapLibraryName });
      const visibleDir = join(ctx.fixture.booksPath, `path-visible-${randomUUID()}`);
      const hiddenDir = join(ctx.fixture.booksPath, `.path-hidden-${randomUUID()}`);
      await mkdir(visibleDir, { recursive: true });
      await mkdir(hiddenDir, { recursive: true });

      const prescanValidDir = join(ctx.fixture.booksPath, `prescan-valid-${randomUUID()}`);
      await mkdir(prescanValidDir, { recursive: true });
      await createEpubFixture(prescanValidDir, 'prescan-book.epub', { title: 'Prescan Valid Title' });

      const pathResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/path?path=${encodeURIComponent(ctx.fixture.booksPath)}`,
        headers: authHeader(manager.accessToken),
      });

      expect(pathResponse.statusCode).toBe(200);
      const pathBody = pathResponse.json() as Array<{ name: string; path: string }>;
      expect(pathBody).toEqual(
        expect.arrayContaining([
          {
            name: basename(overlapLibrary.folderPath),
            path: overlapLibrary.folderPath,
          },
          {
            name: basename(visibleDir),
            path: visibleDir,
          },
          {
            name: basename(prescanValidDir),
            path: prescanValidDir,
          },
        ]),
      );
      expect(pathBody.some((entry) => entry.name === basename(hiddenDir))).toBe(false);

      const blockedPathResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/path?path=/proc',
        headers: authHeader(manager.accessToken),
      });
      expect(blockedPathResponse.statusCode).toBe(200);
      expect(blockedPathResponse.json()).toEqual([]);

      const forbiddenPathResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/path?path=${encodeURIComponent(ctx.fixture.booksPath)}`,
        headers: authHeader(noPermissionUser.accessToken),
      });
      expect(forbiddenPathResponse.statusCode).toBe(403);

      const prescanResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/libraries/prescan',
        headers: authHeader(manager.accessToken),
        payload: {
          paths: [prescanValidDir, overlapLibrary.folderPath, join(ctx.fixture.booksPath, `missing-${randomUUID()}`)],
        },
      });

      expect(prescanResponse.statusCode).toBe(201);
      const prescanBody = prescanResponse.json() as {
        totalFiles: number;
        paths: Array<{
          path: string;
          accessible: boolean;
          fileCount: number;
          overlapLibrary?: string;
          error?: string;
        }>;
      };

      expect(prescanBody.totalFiles).toBe(1);
      expect(prescanBody.paths).toEqual([
        {
          path: prescanValidDir,
          accessible: true,
          fileCount: 1,
          overlapLibrary: undefined,
          error: undefined,
        },
        {
          path: overlapLibrary.folderPath,
          accessible: true,
          fileCount: 0,
          overlapLibrary: overlapLibraryName,
          error: undefined,
        },
        {
          path: expect.stringContaining('/missing-'),
          accessible: false,
          fileCount: 0,
          overlapLibrary: undefined,
          error: 'Path does not exist',
        },
      ]);

      const forbiddenPrescanResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/libraries/prescan',
        headers: authHeader(noPermissionUser.accessToken),
        payload: { paths: [prescanValidDir] },
      });
      expect(forbiddenPrescanResponse.statusCode).toBe(403);
    });
  });

  describe('create library and manage access', () => {
    it('creates a library with the requested settings, requires explicit access rows, and reflects grant/update/revoke changes', async () => {
      const { body: createdLibrary } = await createLibraryViaApi(ctx, manager.accessToken, {
        name: `library-contract-${randomUUID()}`,
      });

      expect(createdLibrary).toMatchObject({
        id: expect.any(Number),
        name: expect.stringContaining('library-contract-'),
        icon: 'library',
        watch: false,
        allowedFormats: ['epub'],
        organizationMode: 'book_per_file',
        excludePatterns: ['*.tmp'],
        readingThreshold: 0.4,
        markAsFinishedPercentComplete: 95,
        fileWriteEnabled: false,
      });
      expect(createdLibrary.folders).toHaveLength(1);
      expect(createdLibrary.folders[0]).toMatchObject({
        id: expect.any(Number),
        path: expect.any(String),
      });

      await waitForNoRunningScans(ctx, createdLibrary.id);

      const managerLibrariesBeforeGrant = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/libraries',
        headers: authHeader(manager.accessToken),
      });
      expect(managerLibrariesBeforeGrant.statusCode).toBe(200);
      const visibleLibraryIdsBeforeGrant = (managerLibrariesBeforeGrant.json() as Array<{ id: number }>).map((library) => library.id);
      expect(visibleLibraryIdsBeforeGrant).not.toContain(createdLibrary.id);

      const managerStatsBeforeGrant = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/stats`,
        headers: authHeader(manager.accessToken),
      });
      expectError(managerStatsBeforeGrant, 403, 'No library access');

      const forbiddenAccessLookup = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/access`,
        headers: authHeader(noPermissionUser.accessToken),
      });
      expect(forbiddenAccessLookup.statusCode).toBe(403);

      const selfGrantResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${createdLibrary.id}/access`,
        headers: authHeader(manager.accessToken),
        payload: {
          userId: manager.userId,
          accessLevel: 'owner',
        },
      });
      expect(selfGrantResponse.statusCode).toBe(201);

      const scopedGrantResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${createdLibrary.id}/access`,
        headers: authHeader(manager.accessToken),
        payload: {
          userId: scopedUser.userId,
          accessLevel: 'viewer',
        },
      });
      expect(scopedGrantResponse.statusCode).toBe(201);

      const accessResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/access`,
        headers: authHeader(manager.accessToken),
      });
      expect(accessResponse.statusCode).toBe(200);
      expect(accessResponse.json()).toEqual(
        expect.arrayContaining([
          {
            userId: manager.userId,
            accessLevel: 'owner',
            username: manager.username,
            name: expect.any(String),
          },
          {
            userId: scopedUser.userId,
            accessLevel: 'viewer',
            username: scopedUser.username,
            name: expect.any(String),
          },
        ]),
      );

      const updateAccessResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/libraries/${createdLibrary.id}/access/${scopedUser.userId}`,
        headers: authHeader(manager.accessToken),
        payload: {
          accessLevel: 'editor',
        },
      });
      expect(updateAccessResponse.statusCode).toBe(200);

      const accessAfterUpdate = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/access`,
        headers: authHeader(manager.accessToken),
      });
      expect(accessAfterUpdate.statusCode).toBe(200);
      expect(accessAfterUpdate.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: scopedUser.userId,
            accessLevel: 'editor',
          }),
        ]),
      );

      const managerLibrariesAfterGrant = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/libraries',
        headers: authHeader(manager.accessToken),
      });
      expect(managerLibrariesAfterGrant.statusCode).toBe(200);
      expect((managerLibrariesAfterGrant.json() as Array<{ id: number }>).map((library) => library.id)).toContain(createdLibrary.id);

      const revokeAccessResponse = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/libraries/${createdLibrary.id}/access/${scopedUser.userId}`,
        headers: authHeader(manager.accessToken),
      });
      expect(revokeAccessResponse.statusCode).toBe(204);

      const revokedLibraryResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}`,
        headers: authHeader(scopedUser.accessToken),
      });
      expectError(revokedLibraryResponse, 403, 'No library access');
    });
  });

  describe('upload, scan, and stats', () => {
    it('enforces upload boundaries, persists uploaded files, scans direct file additions, and isolates stats after access revocation', async () => {
      const { body: createdLibrary } = await createLibraryViaApi(ctx, manager.accessToken, {
        name: `library-upload-${randomUUID()}`,
      });
      await waitForNoRunningScans(ctx, createdLibrary.id);

      const libraryFolder = createdLibrary.folders[0]!;
      const otherLibrary = await createLibraryWithFolder(ctx, { name: `other-folder-${randomUUID()}` });

      await grantLibraryAccess(ctx, manager.userId, createdLibrary.id, 'owner');
      await grantLibraryAccess(ctx, scopedUser.userId, createdLibrary.id, 'viewer');
      await grantLibraryAccess(ctx, noPermissionUser.userId, createdLibrary.id, 'viewer');

      const uploadBytes = await createUploadFixtureBytes(ctx, `upload-fixtures/${randomUUID()}/uploaded-contract.epub`, 'Uploaded Contract Title');

      const uploadForbiddenByAccess = await uploadLibraryFile(ctx, {
        token: uploadOnlyUser.accessToken,
        libraryId: createdLibrary.id,
        folderId: libraryFolder.id,
        fileName: 'uploaded-contract.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expectError(uploadForbiddenByAccess, 403, 'No access to this library');

      const uploadForbiddenByPermission = await uploadLibraryFile(ctx, {
        token: noPermissionUser.accessToken,
        libraryId: createdLibrary.id,
        folderId: libraryFolder.id,
        fileName: 'uploaded-contract.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expect(uploadForbiddenByPermission.statusCode).toBe(403);

      const invalidFolderIdUpload = await uploadLibraryFileWithRawQuery(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
        query: '?folderId=not-a-number',
        file: {
          fileName: 'invalid-folder.epub',
          content: uploadBytes,
          contentType: 'application/epub+zip',
        },
      });
      expectError(invalidFolderIdUpload, 400, 'Invalid folderId');

      const wrongFolderUpload = await uploadLibraryFile(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
        folderId: otherLibrary.libraryFolderId,
        fileName: 'wrong-folder.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expectError(wrongFolderUpload, 400, 'Folder does not belong to this library');

      const missingFileUpload = await uploadLibraryFileWithRawQuery(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
      });
      expectError(missingFileUpload, 400, 'No file provided');

      const successfulUpload = await uploadLibraryFile(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
        folderId: libraryFolder.id,
        fileName: 'uploaded-contract.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expect(successfulUpload.statusCode).toBe(201);
      const uploadBody = successfulUpload.json() as {
        bookId: number;
        filename: string;
        format: string;
        sizeBytes: number;
      };
      expect(uploadBody).toEqual({
        bookId: expect.any(Number),
        filename: 'Uploaded Contract Title.epub',
        format: 'epub',
        sizeBytes: uploadBytes.length,
      });

      await waitForCondition(() => {
        expect(ctx.metadataMock.extractAndSave).toHaveBeenCalledWith(uploadBody.bookId, expect.any(String), 'epub');
      }, 10_000);

      const uploadedBook = await ctx.db.query.books.findFirst({
        where: eq(schema.books.id, uploadBody.bookId),
      });
      expect(uploadedBook).toMatchObject({
        libraryId: createdLibrary.id,
        libraryFolderId: libraryFolder.id,
        status: 'present',
      });

      const uploadedBookFile = await ctx.db.query.bookFiles.findFirst({
        where: eq(schema.bookFiles.bookId, uploadBody.bookId),
      });
      expect(uploadedBookFile).toMatchObject({
        libraryFolderId: libraryFolder.id,
        format: 'epub',
      });
      expect(uploadedBookFile?.absolutePath).toContain('Uploaded Contract Title.epub');
      expect(uploadedBookFile?.relPath).toBe('Uploaded Contract Title.epub');

      const uploadedMetadataRow = await ctx.db.query.bookMetadata.findFirst({
        where: eq(schema.bookMetadata.bookId, uploadBody.bookId),
      });
      expect(uploadedMetadataRow).toBeDefined();

      const duplicateUpload = await uploadLibraryFile(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
        folderId: libraryFolder.id,
        fileName: 'uploaded-contract.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expectError(duplicateUpload, 409, 'already exists at the target location');

      const scannedFilePath = await createEpubFixture(libraryFolder.path, 'scanned-discovered.epub', {
        title: 'Scanned Discovered Title',
      });

      const scanResponseForbidden = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/scanner/libraries/${createdLibrary.id}/scan`,
        headers: authHeader(noPermissionUser.accessToken),
      });
      expect(scanResponseForbidden.statusCode).toBe(403);

      const scanJob = await startLibraryScanAs(ctx, manager.accessToken, createdLibrary.id);
      expect(scanJob.status).toBe('completed');
      await waitForNoRunningScans(ctx, createdLibrary.id);

      await waitForCondition(async () => {
        const presentBooks = await ctx.db.query.books.findMany({
          where: and(eq(schema.books.libraryId, createdLibrary.id), eq(schema.books.status, 'present')),
        });
        expect(presentBooks).toHaveLength(2);
      }, 10_000);

      const scannedBook = await locateBookByAbsolutePath(ctx, scannedFilePath);
      expect(scannedBook.libraryId).toBe(createdLibrary.id);
      expect(scannedBook.format).toBe('epub');

      const statsResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/stats`,
        headers: authHeader(scopedUser.accessToken),
      });
      expect(statsResponse.statusCode).toBe(200);

      const primaryFiles = await ctx.db
        .select({
          sizeBytes: schema.bookFiles.sizeBytes,
        })
        .from(schema.books)
        .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
        .where(and(eq(schema.books.libraryId, createdLibrary.id), eq(schema.books.status, 'present')));
      const expectedTotalSize = primaryFiles.reduce((sum, row) => sum + Number(row.sizeBytes ?? 0), 0);

      expect(statsResponse.json()).toEqual({
        totalBooks: 2,
        totalSizeBytes: expectedTotalSize,
        formatCounts: {
          epub: 2,
        },
      });

      const revokeScopedAccess = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/libraries/${createdLibrary.id}/access/${scopedUser.userId}`,
        headers: authHeader(manager.accessToken),
      });
      expect(revokeScopedAccess.statusCode).toBe(204);

      const revokedStatsResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}/stats`,
        headers: authHeader(scopedUser.accessToken),
      });
      expectError(revokedStatsResponse, 403, 'No library access');
    });
  });

  describe('refresh covers, reorder, and delete', () => {
    it('queues cover refresh for each primary file, reorders libraries, and deletes a populated library while cleaning cover artifacts', async () => {
      const { body: createdLibrary } = await createLibraryViaApi(ctx, manager.accessToken, {
        name: `library-refresh-${randomUUID()}`,
      });
      await waitForNoRunningScans(ctx, createdLibrary.id);
      await grantLibraryAccess(ctx, manager.userId, createdLibrary.id, 'owner');

      const reorderPeerLibrary = await createLibraryWithFolder(ctx, { name: `library-peer-${randomUUID()}` });
      const peerCoverLibrary = await createLibraryWithFolder(ctx, { name: `library-cover-peer-${randomUUID()}` });
      await grantLibraryAccess(ctx, manager.userId, reorderPeerLibrary.libraryId, 'owner');
      await grantLibraryAccess(ctx, manager.userId, peerCoverLibrary.libraryId, 'owner');

      const uploadBytes = await createUploadFixtureBytes(ctx, `refresh-fixtures/${randomUUID()}/refresh-upload.epub`, 'Refresh Upload Title');
      const libraryFolder = createdLibrary.folders[0]!;

      const uploadResponse = await uploadLibraryFile(ctx, {
        token: manager.accessToken,
        libraryId: createdLibrary.id,
        folderId: libraryFolder.id,
        fileName: 'refresh-upload.epub',
        content: uploadBytes,
        contentType: 'application/epub+zip',
      });
      expect(uploadResponse.statusCode).toBe(201);
      const uploadedBookId = (uploadResponse.json() as { bookId: number }).bookId;

      const scannedFilePath = await createEpubFixture(libraryFolder.path, 'refresh-scanned.epub', {
        title: 'Refresh Scanned Title',
      });
      await startLibraryScanAs(ctx, manager.accessToken, createdLibrary.id);
      const scannedBook = await locateBookByAbsolutePath(ctx, scannedFilePath);

      ctx.metadataMock.refreshCoverForBook.mockClear();
      const refreshCoversResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/scanner/libraries/${createdLibrary.id}/refresh-covers`,
        headers: authHeader(manager.accessToken),
      });
      expect(refreshCoversResponse.statusCode).toBe(202);
      expect(refreshCoversResponse.json()).toEqual({ queued: 2 });

      const refreshCalls = await waitForCoverRefreshCalls(ctx, 2);
      const normalizedCalls = refreshCalls
        .map(([bookId, absolutePath, format]) => ({
          bookId,
          absolutePath,
          format,
        }))
        .sort((left, right) => left.bookId - right.bookId);
      expect(normalizedCalls).toEqual([
        {
          bookId: uploadedBookId,
          absolutePath: expect.any(String),
          format: 'epub',
        },
        {
          bookId: scannedBook.bookId,
          absolutePath: expect.any(String),
          format: 'epub',
        },
      ]);

      await writeFixtureFile(ctx.fixture.booksPath, `covers/${uploadedBookId}/cover_custom.jpg`, Buffer.from('cover', 'utf8'));
      await writeFixtureFile(ctx.fixture.booksPath, `covers/${uploadedBookId}/thumbnail.jpg`, Buffer.from('thumb', 'utf8'));

      const reorderResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/libraries/reorder',
        headers: authHeader(manager.accessToken),
        payload: {
          order: [
            { id: createdLibrary.id, displayOrder: 9 },
            { id: reorderPeerLibrary.libraryId, displayOrder: 1 },
            { id: peerCoverLibrary.libraryId, displayOrder: 2 },
          ],
        },
      });
      expect(reorderResponse.statusCode).toBe(204);

      const adminLibrariesResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/libraries',
        headers: authHeader(ctx.adminToken),
      });
      expect(adminLibrariesResponse.statusCode).toBe(200);
      const orderedLibraries = (adminLibrariesResponse.json() as Array<{ id: number; displayOrder: number }>).filter((library) =>
        [createdLibrary.id, reorderPeerLibrary.libraryId, peerCoverLibrary.libraryId].includes(library.id),
      );
      expect(orderedLibraries.map((library) => ({ id: library.id, displayOrder: library.displayOrder }))).toEqual([
        { id: reorderPeerLibrary.libraryId, displayOrder: 1 },
        { id: peerCoverLibrary.libraryId, displayOrder: 2 },
        { id: createdLibrary.id, displayOrder: 9 },
      ]);

      const deleteResponse = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/libraries/${createdLibrary.id}`,
        headers: authHeader(manager.accessToken),
      });
      expect(deleteResponse.statusCode).toBe(204);

      const deletedLibraryResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/libraries/${createdLibrary.id}`,
        headers: authHeader(ctx.adminToken),
      });
      expectError(deletedLibraryResponse, 404, 'Library not found');

      const deletedLibraryBooks = await ctx.db
        .select({ id: schema.books.id })
        .from(schema.books)
        .where(eq(schema.books.libraryId, createdLibrary.id));
      expect(deletedLibraryBooks).toHaveLength(0);

      const deletedAccessRows = await ctx.db
        .select({ userId: schema.userLibraryAccess.userId })
        .from(schema.userLibraryAccess)
        .where(eq(schema.userLibraryAccess.libraryId, createdLibrary.id));
      expect(deletedAccessRows).toHaveLength(0);

      await expect(access(join(ctx.fixture.booksPath, 'covers', String(uploadedBookId)))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });
});
