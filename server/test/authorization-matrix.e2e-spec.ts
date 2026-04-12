import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { ConfigService } from '@nestjs/config';
import { Permission } from '@projectx/types';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createCoverToken } from '../src/modules/opds/opds-auth.guard';
import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createBookCoverArtifacts,
  createKoboDevice,
  createLibraryWithFolder,
  createOpdsUser,
  createReadingSession,
  createBookBucketRow,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  replaceUserPermissions,
  setSetting,
  setUserActive,
  triggerAndWaitForLibraryScan,
  uploadLibraryFile,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';
import { createEpubFixture } from './e2e/authorization-matrix/authorization-matrix-fixture-builder';

type SupportedHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

interface RouteInventoryRoute {
  file: string;
  className: string;
  methodName: string;
  httpMethod: string;
  path: string;
  permissions: string[];
  libraryAccess: string[];
  isPublic: boolean;
  allowDefault: boolean;
  useGuards: string[];
}

interface RouteInventory {
  totalRoutes: number;
  byPermission: Record<string, number>;
  byLibraryAccess: Record<string, number>;
  routes: RouteInventoryRoute[];
}

interface RouteInventoryManifest {
  totalRoutes: number;
  byPermission: Record<string, number>;
  byLibraryAccess: Record<string, number>;
  routeChunks: string[];
}

interface MatrixFailure {
  route: string;
  status: number;
  reason: string;
  message: string;
}

interface Personas {
  basicUser: TestUserSession;
  defaultPwdUser: TestUserSession;
  allPermsUser: TestUserSession;
  permsNoLibraryUser: TestUserSession;
  manageUsersAdmin: TestUserSession;
  metadataEditor: TestUserSession;
  opdsOwner: TestUserSession;
  opdsIntruder: TestUserSession;
  opdsDisabled: TestUserSession;
  opdsRevoked: TestUserSession;
  koboActive: TestUserSession;
  koboDisabled: TestUserSession;
  koboRevoked: TestUserSession;
  bookBucketUser: TestUserSession;
  uploadUser: TestUserSession;
  ownerUser: TestUserSession;
  otherUser: TestUserSession;
  targetSuperuser: TestUserSession;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const routeInventory = loadRouteInventory();

const supportedMethods = new Set<SupportedHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function loadRouteInventory(): RouteInventory {
  const inventoryDir = join(currentDir, 'e2e/authorization-matrix/route-inventory');
  const manifest = JSON.parse(readFileSync(join(inventoryDir, 'manifest.json'), 'utf8')) as RouteInventoryManifest;
  const routes = manifest.routeChunks.flatMap(
    (chunkFile) => JSON.parse(readFileSync(join(inventoryDir, chunkFile), 'utf8')) as RouteInventoryRoute[],
  );

  return {
    totalRoutes: manifest.totalRoutes,
    byPermission: manifest.byPermission,
    byLibraryAccess: manifest.byLibraryAccess,
    routes,
  };
}

describe('Authorization matrix (e2e)', () => {
  let ctx: AuthorizationMatrixE2EContext;
  let libraryA: CreatedLibrary;
  let libraryB: CreatedLibrary;
  let libraryC: CreatedLibrary;
  let bookA: LocatedBookFile;
  let bookB: LocatedBookFile;
  let bookC: LocatedBookFile;
  let personas: Personas;
  let authorOnlyBId: number;
  let authorMixedId: number;
  let inaccessibleSessionId: number;
  let koboActiveDeviceToken: string;
  let koboDisabledDeviceToken: string;
  let koboRevokedDeviceToken: string;
  let opdsValidCreds: { username: string; password: string };
  let opdsDisabledCreds: { username: string; password: string };
  let opdsRevokedCreds: { username: string; password: string };

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    libraryA = await createLibraryWithFolder(ctx, { name: `authz-lib-a-${randomUUID()}` });
    libraryB = await createLibraryWithFolder(ctx, { name: `authz-lib-b-${randomUUID()}` });
    libraryC = await createLibraryWithFolder(ctx, { name: `authz-lib-c-${randomUUID()}` });

    const fileAPath = await createEpubFixture(libraryA.folderPath, 'book-a.epub', { title: 'Authorization Matrix Library A' });
    const fileBPath = await createEpubFixture(libraryB.folderPath, 'book-b.epub', { title: 'Authorization Matrix Library B' });
    const fileCPath = await createEpubFixture(libraryC.folderPath, 'book-c.epub', { title: 'Authorization Matrix Library C' });

    await triggerAndWaitForLibraryScan(ctx, libraryA.libraryId);
    await triggerAndWaitForLibraryScan(ctx, libraryB.libraryId);
    await triggerAndWaitForLibraryScan(ctx, libraryC.libraryId);

    bookA = await locateBookByAbsolutePath(ctx, fileAPath);
    bookB = await locateBookByAbsolutePath(ctx, fileBPath);
    bookC = await locateBookByAbsolutePath(ctx, fileCPath);

    await createBookCoverArtifacts(ctx, bookA.bookId);
    await createBookCoverArtifacts(ctx, bookB.bookId);
    await createBookCoverArtifacts(ctx, bookC.bookId);

    const allPermissions = Object.values(Permission);
    personas = {
      basicUser: await createUserAndLogin(ctx),
      defaultPwdUser: await createUserAndLogin(ctx, {
        password: 'DefaultPassword123',
        isDefaultPassword: true,
      }),
      allPermsUser: await createUserAndLogin(ctx, { permissions: allPermissions }),
      permsNoLibraryUser: await createUserAndLogin(ctx, { permissions: allPermissions }),
      manageUsersAdmin: await createUserAndLogin(ctx, { permissions: [Permission.ManageUsers] }),
      metadataEditor: await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] }),
      opdsOwner: await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] }),
      opdsIntruder: await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] }),
      opdsDisabled: await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] }),
      opdsRevoked: await createUserAndLogin(ctx, { permissions: [Permission.OpdsAccess] }),
      koboActive: await createUserAndLogin(ctx, { permissions: [Permission.KoboSync] }),
      koboDisabled: await createUserAndLogin(ctx, { permissions: [Permission.KoboSync] }),
      koboRevoked: await createUserAndLogin(ctx, { permissions: [Permission.KoboSync] }),
      bookBucketUser: await createUserAndLogin(ctx, { permissions: [Permission.BookBucketAccess] }),
      uploadUser: await createUserAndLogin(ctx, { permissions: [Permission.LibraryUpload] }),
      ownerUser: await createUserAndLogin(ctx),
      otherUser: await createUserAndLogin(ctx),
      targetSuperuser: await createUserAndLogin(ctx, { isSuperuser: true }),
    };

    await Promise.all([
      grantLibraryAccess(ctx, personas.allPermsUser.userId, libraryA.libraryId, 'owner'),
      grantLibraryAccess(ctx, personas.allPermsUser.userId, libraryB.libraryId, 'owner'),
      grantLibraryAccess(ctx, personas.metadataEditor.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.bookBucketUser.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.ownerUser.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.opdsOwner.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.opdsIntruder.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.opdsDisabled.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.opdsRevoked.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.koboActive.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.koboDisabled.userId, libraryA.libraryId, 'viewer'),
      grantLibraryAccess(ctx, personas.koboRevoked.userId, libraryA.libraryId, 'viewer'),
    ]);

    await setUserActive(ctx, personas.opdsDisabled.userId, false);
    await replaceUserPermissions(ctx, personas.opdsRevoked.userId, []);
    await setUserActive(ctx, personas.koboDisabled.userId, false);
    await replaceUserPermissions(ctx, personas.koboRevoked.userId, []);

    const [authorOnlyB, authorMixed] = await ctx.db
      .insert(schema.authors)
      .values([{ name: `authz-author-only-b-${randomUUID()}` }, { name: `authz-author-mixed-${randomUUID()}` }])
      .returning({ id: schema.authors.id });

    authorOnlyBId = authorOnlyB.id;
    authorMixedId = authorMixed.id;

    await ctx.db.insert(schema.bookAuthors).values([
      { bookId: bookB.bookId, authorId: authorOnlyBId, displayOrder: 0 },
      { bookId: bookA.bookId, authorId: authorMixedId, displayOrder: 0 },
      { bookId: bookB.bookId, authorId: authorMixedId, displayOrder: 0 },
    ]);

    await ctx.db.insert(schema.userBookStatus).values({
      userId: personas.ownerUser.userId,
      bookId: bookA.bookId,
      status: 'reading',
      source: 'manual',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      finishedAt: null,
    });

    const session = await createReadingSession(ctx, {
      userId: personas.ownerUser.userId,
      bookFileId: bookB.bookFileId,
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      endedAt: new Date('2026-01-01T10:30:00.000Z'),
      progressDelta: 12.5,
      endProgress: 33,
    });
    inaccessibleSessionId = session.id;

    koboActiveDeviceToken = (await createKoboDevice(ctx, personas.koboActive.userId, 'authz-kobo-active')).token;
    koboDisabledDeviceToken = (await createKoboDevice(ctx, personas.koboDisabled.userId, 'authz-kobo-disabled')).token;
    koboRevokedDeviceToken = (await createKoboDevice(ctx, personas.koboRevoked.userId, 'authz-kobo-revoked')).token;

    const [koboSyncCollection] = await ctx.db
      .insert(schema.collections)
      .values({
        userId: personas.koboActive.userId,
        name: `authz-kobo-sync-${randomUUID()}`,
        syncToKobo: true,
      })
      .returning({ id: schema.collections.id });

    await ctx.db.insert(schema.collectionBooks).values([
      { collectionId: koboSyncCollection.id, bookId: bookA.bookId },
      { collectionId: koboSyncCollection.id, bookId: bookB.bookId },
    ]);

    const validOpds = await createOpdsUser(ctx, {
      userId: personas.opdsOwner.userId,
      username: `authz-opds-valid-${randomUUID().slice(0, 8)}`,
      password: 'OpdsValidPass123',
    });
    const disabledOpds = await createOpdsUser(ctx, {
      userId: personas.opdsDisabled.userId,
      username: `authz-opds-disabled-${randomUUID().slice(0, 8)}`,
      password: 'OpdsDisabledPass123',
    });
    const revokedOpds = await createOpdsUser(ctx, {
      userId: personas.opdsRevoked.userId,
      username: `authz-opds-revoked-${randomUUID().slice(0, 8)}`,
      password: 'OpdsRevokedPass123',
    });

    opdsValidCreds = { username: validOpds.row.username, password: validOpds.password };
    opdsDisabledCreds = { username: disabledOpds.row.username, password: disabledOpds.password };
    opdsRevokedCreds = { username: revokedOpds.row.username, password: revokedOpds.password };
  }, 240_000);

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  describe('guard matrix - jwt/permission/library/default-password', () => {
    it('rejects unauthenticated access to every non-public route', async () => {
      const failures: MatrixFailure[] = [];
      const protectedRoutes = routeInventory.routes.filter((route) => !route.isPublic && isSupportedMethod(route.httpMethod));

      for (const route of protectedRoutes) {
        const response = await invokeRoute(route);
        if (response.statusCode !== 401) {
          failures.push({
            route: routeLabel(route),
            status: response.statusCode,
            reason: 'expected 401 for unauthenticated request',
            message: extractMessage(response),
          });
        }
      }

      assertNoFailures('protected authentication matrix', failures);
    }, 180_000);

    it('rejects every permission-decorated route when permission is missing', async () => {
      const failures: MatrixFailure[] = [];
      const permissionRoutes = routeInventory.routes.filter(
        (route) => !route.isPublic && route.permissions.length > 0 && isSupportedMethod(route.httpMethod),
      );

      for (const route of permissionRoutes) {
        const response = await invokeRoute(route, { token: personas.basicUser.accessToken });
        const message = extractMessage(response);
        if (response.statusCode !== 403 || !message.includes('Missing permission:')) {
          failures.push({
            route: routeLabel(route),
            status: response.statusCode,
            reason: 'expected Missing permission denial',
            message,
          });
        }
      }

      assertNoFailures('permission denial matrix', failures);
    }, 180_000);

    it('proves allow-path for each permission without missing-permission errors', async () => {
      const permissionRoutes = routeInventory.routes.filter(
        (route) => !route.isPublic && route.permissions.length > 0 && isSupportedMethod(route.httpMethod),
      );
      const inventoryPermissions = Array.from(new Set(permissionRoutes.flatMap((route) => route.permissions)))
        .map((raw) => toPermission(raw))
        .filter((permission): permission is Permission => permission !== null)
        .sort();
      const enumPermissions = [...Object.values(Permission)].sort();
      expect(inventoryPermissions).toEqual(enumPermissions);

      const probes: Record<
        Permission,
        {
          method: SupportedHttpMethod;
          path: string;
          query?: string;
          payload?: Record<string, unknown>;
          token: 'allPerms' | 'uploadUser';
        }
      > = {
        [Permission.LibraryDownload]: {
          method: 'POST',
          path: '/books/export',
          payload: { bookIds: [999_999] },
          token: 'allPerms',
        },
        [Permission.LibraryUpload]: {
          method: 'POST',
          path: '/libraries/:id/upload',
          token: 'uploadUser',
        },
        [Permission.LibraryEditMetadata]: {
          method: 'GET',
          path: '/books/:id/write-log',
          token: 'allPerms',
        },
        [Permission.LibraryDeleteBooks]: {
          method: 'DELETE',
          path: '/books',
          payload: { bookIds: [999_999] },
          token: 'allPerms',
        },
        [Permission.KoboSync]: {
          method: 'GET',
          path: '/kobo/devices',
          token: 'allPerms',
        },
        [Permission.OpdsAccess]: {
          method: 'GET',
          path: '/opds-users',
          token: 'allPerms',
        },
        [Permission.BookBucketAccess]: {
          method: 'GET',
          path: '/book-bucket/summary',
          token: 'allPerms',
        },
        [Permission.EmailSend]: {
          method: 'GET',
          path: '/email/providers',
          token: 'allPerms',
        },
        [Permission.ManageEmail]: {
          method: 'GET',
          path: '/email/admin/log',
          token: 'allPerms',
        },
        [Permission.ManageLibraries]: {
          method: 'GET',
          path: '/path',
          query: 'path=/proc',
          token: 'allPerms',
        },
        [Permission.ManageMetadataConfig]: {
          method: 'GET',
          path: '/metadata-preferences/global',
          token: 'allPerms',
        },
        [Permission.ManageAppSettings]: {
          method: 'GET',
          path: '/app-settings',
          token: 'allPerms',
        },
        [Permission.ManageUsers]: {
          method: 'GET',
          path: '/users',
          token: 'allPerms',
        },
        [Permission.ViewAuditLog]: {
          method: 'GET',
          path: '/audit-log',
          token: 'allPerms',
        },
      };

      const failures: MatrixFailure[] = [];

      for (const permission of Object.values(Permission)) {
        const probe = probes[permission];
        const inventoryRoute = routeInventory.routes.find((route) => route.httpMethod === probe.method && route.path === probe.path);
        expect(inventoryRoute).toBeTruthy();
        expect(inventoryRoute?.permissions).toContain(`Permission.${permissionEnumKey(permission)}`);

        const response =
          permission === Permission.LibraryUpload
            ? await uploadLibraryFile(ctx, {
                token: personas.uploadUser.accessToken,
                libraryId: libraryA.libraryId,
                folderId: libraryA.libraryFolderId,
                fileName: `permission-probe-${randomUUID()}.epub`,
                content: 'permission probe content',
              })
            : await ctx.app.inject({
                method: probe.method,
                url: buildUrl(probe.path, probe.query),
                headers: authHeader(personas.allPermsUser.accessToken),
                payload: probe.method === 'GET' ? undefined : (probe.payload ?? {}),
              });

        const message = extractMessage(response);
        if (response.statusCode === 403 && message.includes('Missing permission:')) {
          failures.push({
            route: `${String(permission)} -> ${probe.method} ${probe.path}`,
            status: response.statusCode,
            reason: 'permission allow-path still denied by PermissionGuard',
            message,
          });
        }
      }

      assertNoFailures('permission allow probes', failures);
    }, 120_000);

    it('covers all library-access guard failure and bypass cases', async () => {
      const guardedRoutes = routeInventory.routes.filter(
        (route) => !route.isPublic && route.libraryAccess.length > 0 && isSupportedMethod(route.httpMethod),
      );
      expect(guardedRoutes.map(routeLabel).sort()).toEqual(
        ['GET /libraries/:id', 'POST /libraries/:id/books', 'GET /libraries/:id/stats', 'POST /libraries/:id/write-metadata-to-files'].sort(),
      );

      for (const route of guardedRoutes) {
        const invalidResponse = await invokeRoute(route, {
          token: personas.allPermsUser.accessToken,
          params: { id: 'not-a-number' },
          query: route.path === '/libraries/:id/write-metadata-to-files' ? 'dryRun=true' : undefined,
        });
        expectError(invalidResponse, 400, 'Missing or invalid libraryId');
      }

      for (const route of guardedRoutes) {
        const noAccessResponse = await invokeRoute(route, {
          token: personas.permsNoLibraryUser.accessToken,
          query: route.path === '/libraries/:id/write-metadata-to-files' ? 'dryRun=true' : undefined,
        });
        expectError(noAccessResponse, 403, 'No library access');
      }

      const insufficientResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${libraryA.libraryId}/write-metadata-to-files?dryRun=true`,
        headers: authHeader(personas.metadataEditor.accessToken),
      });
      expectError(insufficientResponse, 403, 'Insufficient library access level');

      const bypassResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${libraryA.libraryId}/write-metadata-to-files?dryRun=true`,
        headers: authHeader(ctx.adminToken),
      });
      expect(bypassResponse.statusCode).toBe(200);
    }, 120_000);

    it('enforces default-password lock with allow-list exceptions', async () => {
      const blockedResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/libraries',
        headers: authHeader(personas.defaultPwdUser.accessToken),
      });
      expectError(blockedResponse, 403, 'Password change required');

      const meResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(personas.defaultPwdUser.accessToken),
      });
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json()).toEqual(expect.objectContaining({ isDefaultPassword: true }));

      const changePasswordResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: authHeader(personas.defaultPwdUser.accessToken),
        payload: {
          currentPassword: personas.defaultPwdUser.password,
          newPassword: 'ChangedDefaultPassword123',
        },
      });
      expect(changePasswordResponse.statusCode).toBe(204);
    });
  });

  describe('custom public guards - opds', () => {
    beforeEach(async () => {
      await setSetting(ctx, 'opds_enabled', 'true');
    });

    it('rejects all OPDS routes when OPDS is disabled', async () => {
      await setSetting(ctx, 'opds_enabled', 'false');

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
        headers: {
          authorization: basicAuth(opdsValidCreds.username, opdsValidCreds.password),
        },
      });
      expectError(response, 403, 'OPDS server is disabled');
    });

    it('requires basic credentials when no token query is provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
      });
      expectError(response, 401, 'Basic authentication required');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('rejects invalid OPDS basic credentials', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
        headers: {
          authorization: basicAuth(opdsValidCreds.username, 'WrongPassword123'),
        },
      });
      expectError(response, 401, 'Invalid credentials');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('rejects disabled OPDS parent users', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
        headers: {
          authorization: basicAuth(opdsDisabledCreds.username, opdsDisabledCreds.password),
        },
      });
      expectError(response, 401, 'disabled');
    });

    it('rejects OPDS users when parent permission is revoked', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
        headers: {
          authorization: basicAuth(opdsRevokedCreds.username, opdsRevokedCreds.password),
        },
      });
      expectError(response, 403, 'OPDS access revoked');
    });

    it('allows OPDS access with valid basic credentials', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/opds/libraries',
        headers: {
          authorization: basicAuth(opdsValidCreds.username, opdsValidCreds.password),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/atom+xml');
    });

    it('rejects invalid OPDS token auth', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/opds/${bookA.bookId}/cover?t=invalid-token`,
      });
      expectError(response, 401, 'Invalid token');
    });

    it('rejects OPDS token auth on non-image routes', async () => {
      const config = ctx.app.get(ConfigService);
      const jwtSecret = config.getOrThrow<string>('auth.jwtSecret');
      const token = createCoverToken(personas.opdsOwner.userId, jwtSecret);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/opds/libraries?t=${token}`,
      });
      expectError(response, 401, 'Basic authentication required');
      expect(response.headers['www-authenticate']).toContain('Basic realm=');
    });

    it('allows OPDS token auth on image routes when token and permission are valid', async () => {
      const config = ctx.app.get(ConfigService);
      const jwtSecret = config.getOrThrow<string>('auth.jwtSecret');
      const token = createCoverToken(personas.opdsOwner.userId, jwtSecret);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/opds/${bookA.bookId}/cover?t=${token}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
    });
  });

  describe('custom public guards - kobo', () => {
    it('rejects invalid Kobo device tokens', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/kobo/invalid-token/v1/initialization',
      });
      expectError(response, 401, 'Invalid device token');
    });

    it('rejects Kobo routes for disabled accounts', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboDisabledDeviceToken}/v1/initialization`,
      });
      expectError(response, 401, 'Account not found or disabled');
    });

    it('rejects Kobo routes when KoboSync permission is revoked', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboRevokedDeviceToken}/v1/initialization`,
      });
      expectError(response, 401, 'Kobo sync permission revoked');
    });

    it('allows Kobo routes for valid token and permission', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/initialization`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({ Resources: expect.any(Object) }));
    });

    it('keeps library sync scoped to currently accessible libraries', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/library/sync`,
      });
      expect(response.statusCode).toBe(200);
      const entitlements = response.json() as unknown[];
      const syncedBookIds = extractKoboEntitlementBookIds(entitlements);
      expect(syncedBookIds).toContain(bookA.bookId);
      expect(syncedBookIds).not.toContain(bookB.bookId);
    });

    it('does not expose metadata for books outside active library access', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/library/${bookB.bookId}/metadata`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('keeps accessible Kobo media and reading-state flows working', async () => {
      const thumbnail = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/books/${bookA.bookId}/thumbnail/300/300/false/image.jpg`,
      });
      expect(thumbnail.statusCode).toBe(200);

      const writeState = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/library/${bookA.bookId}/state`,
        payload: {
          ReadingStates: [
            {
              EntitlementId: String(bookA.bookId),
              Created: '2026-01-02T00:00:00.000Z',
              LastModified: '2026-01-02T00:00:00.000Z',
              PriorityTimestamp: '2026-01-02T00:00:00.000Z',
              CurrentBookmark: {
                LastModified: '2026-01-02T00:00:00.000Z',
                ProgressPercent: 37,
                ContentSourceProgressPercent: 37,
              },
              Statistics: {
                LastModified: '2026-01-02T00:00:00.000Z',
              },
              StatusInfo: {
                LastModified: '2026-01-02T00:00:00.000Z',
                Status: 'Reading',
                TimesStartedReading: 1,
              },
            },
          ],
        },
      });
      expect(writeState.statusCode).toBe(200);

      const readState = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/library/${bookA.bookId}/state`,
      });
      expect(readState.statusCode).toBe(200);
      expect(readState.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            EntitlementId: String(bookA.bookId),
          }),
        ]),
      );
    });
  });

  describe('service authz - ownership and superuser rules', () => {
    it('enforces non-superuser restrictions on user admin operations', async () => {
      const editSuperuser = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${personas.targetSuperuser.userId}`,
        headers: authHeader(personas.manageUsersAdmin.accessToken),
        payload: { name: 'Attempted Rename' },
      });
      expectError(editSuperuser, 403, 'Only administrators can edit administrator accounts');

      const deleteSelf = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${personas.manageUsersAdmin.userId}`,
        headers: authHeader(personas.manageUsersAdmin.accessToken),
      });
      expectError(deleteSelf, 409, 'You cannot delete your own account');

      const updateOwnPermissions = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${personas.manageUsersAdmin.userId}/permissions`,
        headers: authHeader(personas.manageUsersAdmin.accessToken),
        payload: { permissionNames: [Permission.ManageLibraries] },
      });
      expectError(updateOwnPermissions, 409, 'You cannot modify your own permissions');
    });

    it('enforces author mutation visibility and superuser rules', async () => {
      const hiddenAuthor = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/authors/${authorOnlyBId}`,
        headers: authHeader(personas.metadataEditor.accessToken),
        payload: { name: `rename-hidden-${randomUUID().slice(0, 6)}` },
      });
      expectError(hiddenAuthor, 404, 'Author not found');

      const relatedLibraryAuthor = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/authors/${authorMixedId}`,
        headers: authHeader(personas.metadataEditor.accessToken),
        payload: { name: `rename-mixed-${randomUUID().slice(0, 6)}` },
      });
      expectError(relatedLibraryAuthor, 403, 'Insufficient library access');

      const mergeAsNonSuper = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/authors/merge',
        headers: authHeader(personas.metadataEditor.accessToken),
        payload: {
          targetAuthorId: authorMixedId,
          sourceAuthorIds: [authorOnlyBId],
        },
      });
      expectError(mergeAsNonSuper, 403, 'Only superusers can merge authors');

      const deleteAsNonSuper = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/authors',
        headers: authHeader(personas.metadataEditor.accessToken),
        payload: {
          authorIds: [authorOnlyBId],
        },
      });
      expectError(deleteAsNonSuper, 403, 'Only superusers can delete authors');
    });

    it('enforces collection ownership and library-scoped book access', async () => {
      const createdCollection = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/collections',
        headers: authHeader(personas.ownerUser.accessToken),
        payload: {
          name: `authz-collection-${randomUUID()}`,
          icon: 'FolderOpen',
        },
      });
      expect(createdCollection.statusCode).toBe(201);
      const collectionId = (createdCollection.json() as { id: number }).id;

      const foreignRead = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/collections/${collectionId}`,
        headers: authHeader(personas.otherUser.accessToken),
      });
      expectError(foreignRead, 403, 'No access to this collection');

      const addInaccessibleBook = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/collections/${collectionId}/books`,
        headers: authHeader(personas.ownerUser.accessToken),
        payload: {
          bookIds: [bookB.bookId],
        },
      });
      expectError(addInaccessibleBook, 403, 'No access to this library');
    });

    it('enforces lens private read and owner-only write rules', async () => {
      const privateLensResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/lenses',
        headers: authHeader(personas.ownerUser.accessToken),
        payload: {
          name: `authz-private-lens-${randomUUID()}`,
          icon: 'Aperture',
          defaultSort: [],
          isPublic: false,
        },
      });
      expect(privateLensResponse.statusCode).toBe(201);
      const privateLensId = (privateLensResponse.json() as { id: number }).id;

      const foreignRead = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/lenses/${privateLensId}`,
        headers: authHeader(personas.otherUser.accessToken),
      });
      expectError(foreignRead, 403, 'No access to this lens');

      const foreignUpdate = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/lenses/${privateLensId}`,
        headers: authHeader(personas.otherUser.accessToken),
        payload: { name: 'rename' },
      });
      expectError(foreignUpdate, 403, 'Cannot modify this lens');

      const foreignDelete = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/lenses/${privateLensId}`,
        headers: authHeader(personas.otherUser.accessToken),
      });
      expectError(foreignDelete, 403, 'Cannot delete this lens');

      const publicLensResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/lenses',
        headers: authHeader(personas.ownerUser.accessToken),
        payload: {
          name: `authz-public-lens-${randomUUID()}`,
          icon: 'Aperture',
          defaultSort: [],
          isPublic: true,
        },
      });
      expect(publicLensResponse.statusCode).toBe(201);
      const publicLensId = (publicLensResponse.json() as { id: number }).id;

      const publicRead = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/lenses/${publicLensId}`,
        headers: authHeader(personas.otherUser.accessToken),
      });
      expect(publicRead.statusCode).toBe(200);
    });

    it('enforces OPDS user ownership checks', async () => {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/opds-users',
        headers: authHeader(personas.opdsOwner.accessToken),
        payload: {
          username: `authz-opds-owned-${randomUUID().slice(0, 8)}`,
          password: 'OwnerScopedPass123',
          sortOrder: 'recent',
        },
      });
      expect(created.statusCode).toBe(201);
      const opdsUserId = (created.json() as { id: number }).id;

      const foreignUpdate = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/opds-users/${opdsUserId}`,
        headers: authHeader(personas.opdsIntruder.accessToken),
        payload: { sortOrder: 'title_asc' },
      });
      expectError(foreignUpdate, 403, 'Not the owner of this OPDS user');

      const foreignDelete = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/opds-users/${opdsUserId}`,
        headers: authHeader(personas.opdsIntruder.accessToken),
      });
      expectError(foreignDelete, 403, 'Not the owner of this OPDS user');
    });
  });

  describe('service authz - library scoped data and mixed batch semantics', () => {
    it('returns mixed-result finalize envelope for Book Bucket authorization failures', async () => {
      const accessibleRow = await createBookBucketRow(ctx, {
        fileName: `authz-finalize-ok-${randomUUID()}.fb2`,
        targetLibraryId: libraryA.libraryId,
        targetFolderId: libraryA.libraryFolderId,
        status: 'ready',
      });
      const inaccessibleRow = await createBookBucketRow(ctx, {
        fileName: `authz-finalize-denied-${randomUUID()}.fb2`,
        targetLibraryId: libraryB.libraryId,
        targetFolderId: libraryB.libraryFolderId,
        status: 'ready',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/book-bucket/finalize',
        headers: authHeader(personas.bookBucketUser.accessToken),
        payload: {
          fileIds: [accessibleRow.id, inaccessibleRow.id],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{ fileId: number; success: boolean; message?: string }>;
      };
      expect(body.total).toBe(2);
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);

      const deniedItem = body.results.find((item) => item.fileId === inaccessibleRow.id);
      expect(deniedItem).toBeTruthy();
      expect(deniedItem?.success).toBe(false);
      expect(deniedItem?.message ?? '').toContain('No access to this library');
    });

    it('requires both upload permission and library access for uploads', async () => {
      const response = await uploadLibraryFile(ctx, {
        token: personas.uploadUser.accessToken,
        libraryId: libraryA.libraryId,
        folderId: libraryA.libraryFolderId,
        fileName: `authz-upload-${randomUUID()}.epub`,
        content: 'upload authz test content',
      });
      expectError(response, 403, 'No access to this library');
    });

    it('intersects unauthorized library filters for statistics and user-statistics', async () => {
      const statisticsSummary = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/statistics/summary?libraryIds=${libraryB.libraryId}`,
        headers: authHeader(personas.ownerUser.accessToken),
      });
      expect(statisticsSummary.statusCode).toBe(200);
      const statisticsBody = statisticsSummary.json() as {
        totalBooks: number;
        totalAuthors: number;
        totalSeries: number;
        totalPublishers: number;
        totalStorageBytes: string | number;
      };
      expect(statisticsBody).toEqual(
        expect.objectContaining({
          totalBooks: 0,
          totalAuthors: 0,
          totalSeries: 0,
          totalPublishers: 0,
        }),
      );
      expect(Number(statisticsBody.totalStorageBytes)).toBe(0);

      const userStatisticsSummary = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/user-statistics/summary?libraryIds=${libraryB.libraryId}`,
        headers: authHeader(personas.ownerUser.accessToken),
      });
      expect(userStatisticsSummary.statusCode).toBe(200);
      expect(userStatisticsSummary.json()).toEqual(
        expect.objectContaining({
          trackedBooks: 0,
          startedBooks: 0,
          inProgressBooks: 0,
          completedBooks: 0,
        }),
      );
    });

    it('returns not found when editing inaccessible session timeline items', async () => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/user-statistics/session-timeline/${inaccessibleSessionId}?libraryIds=${libraryB.libraryId}`,
        headers: authHeader(personas.ownerUser.accessToken),
        payload: {
          startedAt: '2026-01-01T10:00:00.000Z',
          endedAt: '2026-01-01T10:30:00.000Z',
        },
      });
      expectError(response, 404, 'Reading session not found');
    });

    it('keeps blocked path listings empty while still permission-gated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/path?path=/proc',
        headers: authHeader(personas.allPermsUser.accessToken),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe('policy-first regressions', () => {
    it('Kobo thumbnails must reject books outside the device user library access', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/books/${bookB.bookId}/thumbnail/300/300/false/image.jpg`,
      });
      expect([403, 404]).toContain(response.statusCode);
    });

    it('Kobo reading-state updates must reject inaccessible books', async () => {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/kobo/${koboActiveDeviceToken}/v1/library/${bookB.bookId}/state`,
        payload: {
          ReadingStates: [
            {
              EntitlementId: String(bookB.bookId),
              Created: '2026-01-02T00:00:00.000Z',
              LastModified: '2026-01-02T00:00:00.000Z',
              PriorityTimestamp: '2026-01-02T00:00:00.000Z',
              CurrentBookmark: {
                LastModified: '2026-01-02T00:00:00.000Z',
                ProgressPercent: 42,
                ContentSourceProgressPercent: 42,
              },
              Statistics: {
                LastModified: '2026-01-02T00:00:00.000Z',
              },
              StatusInfo: {
                LastModified: '2026-01-02T00:00:00.000Z',
                Status: 'Reading',
                TimesStartedReading: 1,
              },
            },
          ],
        },
      });
      expect([403, 404]).toContain(response.statusCode);
    });
  });

  function isSupportedMethod(method: string): method is SupportedHttpMethod {
    return supportedMethods.has(method as SupportedHttpMethod);
  }

  function routeLabel(route: Pick<RouteInventoryRoute, 'httpMethod' | 'path'>): string {
    return `${route.httpMethod} ${route.path}`;
  }

  function defaultParams(): Record<string, string> {
    return {
      annotationId: '1',
      bookmarkId: '1',
      bookFileId: String(bookA.bookFileId),
      bookId: String(bookA.bookId),
      deviceToken: koboActiveDeviceToken || 'invalid-device-token',
      fileId: String(bookA.bookFileId),
      formatGroup: 'epub',
      height: '300',
      id: String(libraryA.libraryId),
      isGreyscale: 'false',
      key: 'allow_registration',
      libraryId: String(libraryA.libraryId),
      pageIndex: '1',
      productId: '1',
      quality: '85',
      recipientId: '1',
      seriesId: '1',
      sessionId: String(inaccessibleSessionId || 1),
      type: 'books',
      userId: String(personas.ownerUser.userId),
      version: '1',
      width: '300',
    };
  }

  function buildUrl(pathTemplate: string, query?: string, params?: Record<string, string>): string {
    const mergedParams = { ...defaultParams(), ...(params ?? {}) };
    const resolvedPath = pathTemplate
      .replace(/\*/g, 'wildcard')
      .replace(/:([a-zA-Z0-9_]+)/g, (_match, key: string) => encodeURIComponent(mergedParams[key] ?? '1'));

    if (!query) return `/api/v1${resolvedPath}`;
    return `/api/v1${resolvedPath}${query.startsWith('?') ? query : `?${query}`}`;
  }

  async function invokeRoute(
    route: RouteInventoryRoute,
    options: {
      token?: string;
      query?: string;
      payload?: Record<string, unknown>;
      params?: Record<string, string>;
    } = {},
  ): Promise<InjectResponse> {
    const method = route.httpMethod;
    if (!isSupportedMethod(method)) {
      throw new Error(`Unsupported route method in matrix: ${routeLabel(route)}`);
    }

    const request: {
      method: SupportedHttpMethod;
      url: string;
      headers?: Record<string, string>;
      payload?: Record<string, unknown>;
    } = {
      method,
      url: buildUrl(route.path, options.query, options.params),
    };

    if (options.token) {
      request.headers = authHeader(options.token);
    }

    if (method !== 'GET') {
      request.payload = options.payload ?? {};
    }

    return ctx.app.inject(request);
  }

  function parseBody(response: InjectResponse): Record<string, unknown> | null {
    try {
      return response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function extractMessage(response: InjectResponse): string {
    const body = parseBody(response);
    if (!body) return response.body;
    const message = body.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === 'string').join('; ');
    }
    return '';
  }

  function expectError(response: InjectResponse, statusCode: number, messageFragment: string): void {
    expect(response.statusCode).toBe(statusCode);
    const body = parseBody(response);
    if (body && typeof body === 'object') {
      expect(body).toEqual(
        expect.objectContaining({
          statusCode,
        }),
      );
    }
    const message = extractMessage(response);
    expect(message).toContain(messageFragment);
  }

  function assertNoFailures(label: string, failures: MatrixFailure[]): void {
    if (failures.length === 0) return;
    const rendered = failures
      .slice(0, 25)
      .map((failure) => `- ${failure.route}: status=${failure.status}; ${failure.reason}; message="${failure.message}"`)
      .join('\n');
    const suffix = failures.length > 25 ? `\n...and ${failures.length - 25} more` : '';
    throw new Error(`${label} failed (${failures.length} mismatches)\n${rendered}${suffix}`);
  }

  function toPermission(inventoryPermission: string): Permission | null {
    const [scope, key] = inventoryPermission.split('.');
    if (scope !== 'Permission' || !key) return null;
    const asRecord = Permission as unknown as Record<string, Permission>;
    return asRecord[key] ?? null;
  }

  function extractKoboEntitlementBookIds(entitlements: unknown[]): number[] {
    const ids = new Set<number>();
    for (const item of entitlements) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const payload =
        (record.NewEntitlement as Record<string, unknown> | undefined) ??
        (record.ChangedProductMetadata as Record<string, unknown> | undefined) ??
        (record.ChangedEntitlement as Record<string, unknown> | undefined);
      if (!payload || typeof payload !== 'object') continue;
      const entitlement = payload.BookEntitlement as Record<string, unknown> | undefined;
      const rawId = entitlement?.Id ?? entitlement?.RevisionId ?? entitlement?.CrossRevisionId;
      const parsedId = typeof rawId === 'string' ? Number.parseInt(rawId, 10) : Number.NaN;
      if (Number.isFinite(parsedId)) {
        ids.add(parsedId);
      }
    }
    return [...ids];
  }

  function permissionEnumKey(permission: Permission): string {
    const entry = Object.entries(Permission).find(([, value]) => value === permission);
    if (!entry) throw new Error(`Unknown permission value: ${permission}`);
    return entry[0];
  }

  function basicAuth(username: string, password: string): string {
    const value = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return `Basic ${value}`;
  }
});
