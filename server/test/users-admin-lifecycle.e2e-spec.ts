import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import type { Permission } from '@projectx/types';
import { Permission as PermissionEnum } from '@projectx/types';

import {
  authHeader,
  closeUsersAdminLifecycleE2EContext,
  createLibraryWithFolder,
  createOidcUser,
  createUserAndLogin,
  createUsersAdminLifecycleE2EContext,
  setUserActive,
  type CreatedLibrary,
  type OidcUserSeed,
  type TestUserSession,
  type UsersAdminLifecycleE2EContext,
} from './e2e/users-admin-lifecycle/users-admin-lifecycle-harness';

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'users-admin-lifecycle-e2e-scenarios.json');
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

function responseMessage(response: { message?: string | string[] }): string {
  if (Array.isArray(response.message)) return response.message.join(' ');
  return String(response.message ?? '');
}

function expectError(response: Awaited<ReturnType<UsersAdminLifecycleE2EContext['app']['inject']>>, status: number, messageFragment: string): void {
  expect(response.statusCode).toBe(status);
  const message = responseMessage(response.json() as { message?: string | string[] });
  expect(message).toContain(messageFragment);
}

function parseTokenFromResetUrl(resetUrl: string): string {
  const token = new URL(resetUrl).searchParams.get('token');
  if (!token) {
    throw new Error(`Reset URL is missing token: ${resetUrl}`);
  }
  return token;
}

function buildMultipartBody(fileName: string, content: Buffer, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----projectx-users-admin-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([preamble, content, closing]), boundary };
}

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmL8AAAAASUVORK5CYII=', 'base64');

describe('Users admin lifecycle (e2e)', { timeout: 180_000 }, () => {
  let ctx!: UsersAdminLifecycleE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  let libraryA!: CreatedLibrary;
  let libraryB!: CreatedLibrary;

  let manageUsersAdmin!: TestUserSession;
  let manageLibrariesAdmin!: TestUserSession;
  let regularA!: TestUserSession;
  let regularB!: TestUserSession;
  let defaultPasswordUser!: TestUserSession;
  let superuserTarget!: TestUserSession;
  let inactiveAssignable!: TestUserSession;
  let oidcUser!: OidcUserSeed;

  beforeAll(async () => {
    ctx = await createUsersAdminLifecycleE2EContext();

    libraryA = await createLibraryWithFolder(ctx, { name: `users-admin-library-a-${randomUUID()}` });
    libraryB = await createLibraryWithFolder(ctx, { name: `users-admin-library-b-${randomUUID()}` });

    manageUsersAdmin = await createUserAndLogin(ctx, { permissions: [PermissionEnum.ManageUsers] });
    manageLibrariesAdmin = await createUserAndLogin(ctx, { permissions: [PermissionEnum.ManageLibraries] });
    regularA = await createUserAndLogin(ctx);
    regularB = await createUserAndLogin(ctx);
    defaultPasswordUser = await createUserAndLogin(ctx, {
      password: 'DefaultPass123',
      isDefaultPassword: true,
    });
    superuserTarget = await createUserAndLogin(ctx, { isSuperuser: true });
    inactiveAssignable = await createUserAndLogin(ctx);
    await setUserActive(ctx, inactiveAssignable.userId, false);
    oidcUser = await createOidcUser(ctx);
  }, 180_000);

  beforeEach(() => {
    scenarioStartedAt = Date.now();
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
      await closeUsersAdminLifecycleE2EContext(ctx);
    }
  });

  describe('admin route contracts', () => {
    it('returns 404 user not found consistently across target-user admin routes', async () => {
      const missingUserId = 9_999_991;
      const cases: Array<{
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
        url: string;
        payload?: Record<string, unknown>;
      }> = [
        { method: 'GET', url: `/api/v1/users/${missingUserId}` },
        { method: 'PATCH', url: `/api/v1/users/${missingUserId}`, payload: { name: 'ghost' } },
        { method: 'DELETE', url: `/api/v1/users/${missingUserId}` },
        { method: 'PUT', url: `/api/v1/users/${missingUserId}/permissions`, payload: { permissionNames: [PermissionEnum.ManageLibraries] } },
        { method: 'PUT', url: `/api/v1/users/${missingUserId}/superuser`, payload: { isSuperuser: true } },
        { method: 'GET', url: `/api/v1/users/${missingUserId}/libraries` },
        { method: 'PUT', url: `/api/v1/users/${missingUserId}/libraries`, payload: { libraryIds: [libraryA.libraryId] } },
        { method: 'POST', url: `/api/v1/users/${missingUserId}/reset-password` },
      ];

      for (const entry of cases) {
        const response = await ctx.app.inject({
          method: entry.method,
          url: entry.url,
          headers: authHeader(ctx.adminToken),
          ...(entry.payload ? { payload: entry.payload } : {}),
        });
        expectError(response, 404, 'User not found');
      }
    });

    it('validates permission enum inputs and unknown library IDs on create', async () => {
      const invalidPermissionCreate = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          username: `invalid-perm-${randomUUID().slice(0, 8)}`,
          name: 'Invalid Permission User',
          email: `invalid-perm-${randomUUID().slice(0, 8)}@example.com`,
          permissionNames: ['not_a_real_permission'],
        },
      });
      expectError(invalidPermissionCreate, 400, 'permissionNames');

      const unknownLibraryCreate = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          username: `unknown-lib-${randomUUID().slice(0, 8)}`,
          name: 'Unknown Library User',
          email: `unknown-lib-${randomUUID().slice(0, 8)}@example.com`,
          libraryIds: [libraryA.libraryId, 9_999_123],
        },
      });
      expectError(unknownLibraryCreate, 400, 'Unknown library IDs');
    });

    it('covers user create/update/delete, permission assignment, and library assignment lifecycle', async () => {
      const username = `lifecycle-${randomUUID().slice(0, 8)}`;
      const createResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          username,
          name: 'Lifecycle User',
          email: `${username}@example.com`,
          permissionNames: [PermissionEnum.ManageLibraries, PermissionEnum.ManageLibraries],
          libraryIds: [libraryA.libraryId, libraryA.libraryId, libraryB.libraryId],
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json() as { id: number; resetUrl: string };
      expect(created.resetUrl).toContain('/reset-password?token=');

      const readCreated = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${created.id}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(readCreated.statusCode).toBe(200);
      const createdBody = readCreated.json() as { permissions: Permission[] };
      expect(createdBody.permissions).toEqual([PermissionEnum.ManageLibraries]);

      const createdLibraries = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${created.id}/libraries`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(createdLibraries.statusCode).toBe(200);
      expect((createdLibraries.json() as number[]).toSorted((a, b) => a - b)).toEqual(
        [libraryA.libraryId, libraryB.libraryId].toSorted((a, b) => a - b),
      );

      const updateResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${created.id}`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          name: 'Lifecycle User Updated',
          email: `updated-${username}@example.com`,
          active: true,
        },
      });
      expect(updateResponse.statusCode).toBe(200);
      const updated = updateResponse.json() as { name: string; email: string };
      expect(updated).toMatchObject({ name: 'Lifecycle User Updated', email: `updated-${username}@example.com` });

      const permissionUpdate = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${created.id}/permissions`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          permissionNames: [PermissionEnum.LibraryDownload, PermissionEnum.LibraryDownload, PermissionEnum.KoboSync],
        },
      });
      expect(permissionUpdate.statusCode).toBe(204);

      const readAfterPermissionUpdate = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${created.id}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(readAfterPermissionUpdate.statusCode).toBe(200);
      const afterPermissionUpdateBody = readAfterPermissionUpdate.json() as { permissions: Permission[] };
      expect(afterPermissionUpdateBody.permissions).toEqual([PermissionEnum.LibraryDownload, PermissionEnum.KoboSync]);

      const invalidPermissionUpdate = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${created.id}/permissions`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          permissionNames: ['invalid_permission'],
        },
      });
      expectError(invalidPermissionUpdate, 400, 'permissionNames');

      const libraryUpdate = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${created.id}/libraries`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          libraryIds: [libraryB.libraryId, libraryA.libraryId, libraryA.libraryId],
        },
      });
      expect(libraryUpdate.statusCode).toBe(204);

      const readLibrariesAfterUpdate = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${created.id}/libraries`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(readLibrariesAfterUpdate.statusCode).toBe(200);
      expect((readLibrariesAfterUpdate.json() as number[]).toSorted((a, b) => a - b)).toEqual(
        [libraryA.libraryId, libraryB.libraryId].toSorted((a, b) => a - b),
      );

      const deleteResponse = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${created.id}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(deleteResponse.statusCode).toBe(204);

      const readAfterDelete = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${created.id}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expectError(readAfterDelete, 404, 'User not found');
    });
  });

  describe('protection rules', () => {
    it('blocks self-delete, self-deactivate, and self-permission changes', async () => {
      const deleteSelf = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${manageUsersAdmin.userId}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expectError(deleteSelf, 409, 'You cannot delete your own account');

      const deactivateSelf = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${manageUsersAdmin.userId}`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { active: false },
      });
      expectError(deactivateSelf, 409, 'You cannot deactivate your own account');

      const setOwnPermissions = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${manageUsersAdmin.userId}/permissions`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { permissionNames: [PermissionEnum.ManageLibraries] },
      });
      expectError(setOwnPermissions, 409, 'You cannot modify your own permissions');
    });

    it('prevents non-superusers from managing superuser accounts', async () => {
      const editSuperuser = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${superuserTarget.userId}`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { name: 'Attempted Rename' },
      });
      expectError(editSuperuser, 403, 'Only administrators can edit administrator accounts');

      const deleteSuperuser = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${superuserTarget.userId}`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expectError(deleteSuperuser, 403, 'Only administrators can delete administrator accounts');

      const setSuperuserPermissions = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${superuserTarget.userId}/permissions`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { permissionNames: [PermissionEnum.ManageLibraries] },
      });
      expectError(setSuperuserPermissions, 403, 'Only administrators can modify administrator permissions');

      const setSuperuserLibraries = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${superuserTarget.userId}/libraries`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { libraryIds: [libraryA.libraryId] },
      });
      expectError(setSuperuserLibraries, 403, 'Only administrators can edit administrator accounts');

      const resetSuperuserPassword = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${superuserTarget.userId}/reset-password`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expectError(resetSuperuserPassword, 403, 'Only administrators can reset administrator passwords');

      const nonSuperSetSuperuser = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${regularA.userId}/superuser`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { isSuperuser: true },
      });
      expectError(nonSuperSetSuperuser, 403, 'Only administrators can change superuser status');
    });

    it('allows superuser toggling for positive superuser transfer flows', async () => {
      const candidate = await createUserAndLogin(ctx);

      const promote = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${candidate.userId}/superuser`,
        headers: authHeader(ctx.adminToken),
        payload: { isSuperuser: true },
      });
      expect(promote.statusCode).toBe(204);

      const readAfterPromote = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${candidate.userId}`,
        headers: authHeader(ctx.adminToken),
      });
      expect(readAfterPromote.statusCode).toBe(200);
      expect((readAfterPromote.json() as { isSuperuser: boolean }).isSuperuser).toBe(true);

      const demote = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${candidate.userId}/superuser`,
        headers: authHeader(ctx.adminToken),
        payload: { isSuperuser: false },
      });
      expect(demote.statusCode).toBe(204);

      const readAfterDemote = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${candidate.userId}`,
        headers: authHeader(ctx.adminToken),
      });
      expect(readAfterDemote.statusCode).toBe(200);
      expect((readAfterDemote.json() as { isSuperuser: boolean }).isSuperuser).toBe(false);
    });
  });

  describe('profile and avatar behavior', () => {
    it('enforces duplicate email conflicts for admin update and self-update', async () => {
      const adminDuplicateEmail = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${regularB.userId}`,
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: { email: regularA.username + '@example.com' },
      });
      expectError(adminDuplicateEmail, 409, 'Email already in use');

      const selfDuplicateEmail = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: authHeader(regularB.accessToken),
        payload: { email: regularA.username + '@example.com' },
      });
      expectError(selfDuplicateEmail, 409, 'Email already in use');
    });

    it('updates profile settings and enforces avatar upload/read/delete contracts', async () => {
      const updateProfile = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: authHeader(regularA.accessToken),
        payload: {
          name: 'Regular A Updated',
          settings: { syncReaderPreferences: true },
        },
      });
      expect(updateProfile.statusCode).toBe(200);
      const updatedProfile = updateProfile.json() as { name: string; settings: { syncReaderPreferences?: boolean } };
      expect(updatedProfile.name).toBe('Regular A Updated');
      expect(updatedProfile.settings.syncReaderPreferences).toBe(true);

      const noFileUpload = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users/me/avatar',
        headers: authHeader(regularA.accessToken),
      });
      expect(noFileUpload.statusCode).toBe(406);
      const noFileBody = noFileUpload.json() as { message?: string | string[] };
      expect(responseMessage(noFileBody).toLowerCase()).toContain('multipart');

      const nonImageUpload = await uploadAvatar(regularA.accessToken, 'avatar.txt', Buffer.from('hello', 'utf8'), 'text/plain');
      expectError(nonImageUpload, 400, 'File must be an image');

      const invalidImageUpload = await uploadAvatar(regularA.accessToken, 'avatar.png', Buffer.from('invalid-image', 'utf8'), 'image/png');
      expectError(invalidImageUpload, 400, 'Invalid image file');

      const oversizedUpload = await uploadAvatar(regularA.accessToken, 'avatar.jpg', Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'image/jpeg');
      expectError(oversizedUpload, 400, 'Image exceeds 5 MB limit');

      const validUpload = await uploadAvatar(regularA.accessToken, 'avatar.png', onePixelPng, 'image/png');
      expect(validUpload.statusCode).toBe(201);
      const validUploadBody = validUpload.json() as { avatarUrl: string | null };
      expect(validUploadBody.avatarUrl).toContain(`/api/v1/users/${regularA.userId}/avatar?v=`);

      const readOwnAvatar = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${regularA.userId}/avatar`,
        headers: authHeader(regularA.accessToken),
      });
      expect(readOwnAvatar.statusCode).toBe(200);
      const etag = String(readOwnAvatar.headers.etag ?? '');
      expect(etag.length).toBeGreaterThan(0);

      const readOwnAvatarNotModified = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${regularA.userId}/avatar`,
        headers: { ...authHeader(regularA.accessToken), 'if-none-match': etag },
      });
      expect(readOwnAvatarNotModified.statusCode).toBe(304);

      const forbiddenOtherUserRead = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${regularA.userId}/avatar`,
        headers: authHeader(regularB.accessToken),
      });
      expectError(forbiddenOtherUserRead, 403, 'Insufficient permissions to access this avatar');

      const manageUsersRead = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${regularA.userId}/avatar`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect(manageUsersRead.statusCode).toBe(200);

      const deleteOwnAvatar = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/users/me/avatar',
        headers: authHeader(regularA.accessToken),
      });
      expect(deleteOwnAvatar.statusCode).toBe(200);

      const readAfterDelete = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users/${regularA.userId}/avatar`,
        headers: authHeader(regularA.accessToken),
      });
      expect(readAfterDelete.statusCode).toBe(404);
    });
  });

  describe('password reset and default-password behavior', () => {
    it('enforces admin reset lifecycle with consumable tokens and OIDC rejection', async () => {
      const username = `reset-local-${randomUUID().slice(0, 8)}`;
      const createUserResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(manageUsersAdmin.accessToken),
        payload: {
          username,
          name: 'Reset Flow User',
          email: `${username}@example.com`,
        },
      });
      expect(createUserResponse.statusCode).toBe(201);
      const created = createUserResponse.json() as { id: number; resetUrl: string };

      const firstToken = parseTokenFromResetUrl(created.resetUrl);

      const firstReset = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: firstToken,
          newPassword: 'ResetPass123',
        },
      });
      expect(firstReset.statusCode).toBe(204);

      const firstLogin = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username,
          password: 'ResetPass123',
        },
      });
      expect(firstLogin.statusCode).toBe(200);

      const secondResetResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${created.id}/reset-password`,
        headers: authHeader(manageUsersAdmin.accessToken),
      });
      expect([200, 201]).toContain(secondResetResponse.statusCode);
      const secondToken = parseTokenFromResetUrl((secondResetResponse.json() as { resetUrl: string }).resetUrl);

      const reuseFirstToken = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: firstToken,
          newPassword: 'ResetPass456',
        },
      });
      expectError(reuseFirstToken, 400, 'Invalid or expired reset token');

      const useSecondToken = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: secondToken,
          newPassword: 'ResetPass789',
        },
      });
      expect(useSecondToken.statusCode).toBe(204);

      const secondLogin = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username,
          password: 'ResetPass789',
        },
      });
      expect(secondLogin.statusCode).toBe(200);

      const oidcReset = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${oidcUser.userId}/reset-password`,
        headers: authHeader(ctx.adminToken),
      });
      expectError(oidcReset, 400, 'OIDC accounts cannot reset their password here');
    });

    it('enforces default-password guard except allow-listed auth endpoints', async () => {
      const blockedSessions = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: authHeader(defaultPasswordUser.accessToken),
      });
      expectError(blockedSessions, 403, 'Password change required');

      const allowedMe = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(defaultPasswordUser.accessToken),
      });
      expect(allowedMe.statusCode).toBe(200);

      const changePassword = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: authHeader(defaultPasswordUser.accessToken),
        payload: {
          currentPassword: defaultPasswordUser.password,
          newPassword: 'UpdatedDefaultPass123',
        },
      });
      expect(changePassword.statusCode).toBe(204);

      const loginAfterChange = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: defaultPasswordUser.username,
          password: 'UpdatedDefaultPass123',
        },
      });
      expect(loginAfterChange.statusCode).toBe(200);
      const newAccessToken = (loginAfterChange.json() as { accessToken: string }).accessToken;

      const sessionsAfterChange = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: authHeader(newAccessToken),
      });
      expect(sessionsAfterChange.statusCode).toBe(200);
    });
  });

  describe('assignable users contract', () => {
    it('requires manage_libraries and returns active non-superusers only', async () => {
      const unauthorized = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/users/assignable',
        headers: authHeader(regularA.accessToken),
      });
      expectError(unauthorized, 403, 'Missing permission: manage_libraries');

      const authorized = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/users/assignable',
        headers: authHeader(manageLibrariesAdmin.accessToken),
      });
      expect(authorized.statusCode).toBe(200);
      const users = authorized.json() as Array<{ id: number }>;
      const returnedIds = new Set(users.map((entry) => entry.id));

      expect(returnedIds.has(regularA.userId)).toBe(true);
      expect(returnedIds.has(manageUsersAdmin.userId)).toBe(true);
      expect(returnedIds.has(inactiveAssignable.userId)).toBe(false);
      expect(returnedIds.has(superuserTarget.userId)).toBe(false);
    });
  });

  async function uploadAvatar(token: string, fileName: string, content: Buffer, contentType: string) {
    const { body, boundary } = buildMultipartBody(fileName, content, contentType);
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: {
        ...authHeader(token),
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      payload: body,
    });
  }
});
