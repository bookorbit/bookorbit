import { createHash, randomUUID } from 'crypto';

import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import { AppModule } from '../src/app.module';
import { DB } from '../src/db';
import * as schema from '../src/db/schema';
import { MetadataService } from '../src/modules/metadata/metadata.service';
import { makeMetadataNoopMock } from './e2e/app-harness';
import type { Db } from './e2e/app-harness';

type CookieJar = Map<string, string>;

interface AuthE2EContext {
  app: NestFastifyApplication;
  db: Db;
}

interface LocalUserCredentials {
  userId: number;
  username: string;
  password: string;
  email: string;
}

interface LoginResult {
  userId: number;
  accessToken: string;
  refreshToken: string;
  jar: CookieJar;
}

const ADMIN_SETUP_DTO = {
  username: 'auth-e2e-admin',
  name: 'Auth E2E Admin',
  email: 'auth-e2e-admin@example.com',
  password: 'AuthAdmin123',
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getSetCookieLines(headers: Record<string, string | string[] | undefined>): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseCookiePair(setCookieLine: string): { name: string; value: string } | null {
  const firstSegment = setCookieLine.split(';', 1)[0];
  if (!firstSegment) return null;
  const eqIndex = firstSegment.indexOf('=');
  if (eqIndex <= 0) return null;
  return {
    name: firstSegment.slice(0, eqIndex),
    value: firstSegment.slice(eqIndex + 1),
  };
}

function findCookieLine(setCookieLines: string[], cookieName: string): string | undefined {
  return setCookieLines.find((line) => line.startsWith(`${cookieName}=`));
}

function cookieValue(setCookieLines: string[], cookieName: string): string | null {
  const line = findCookieLine(setCookieLines, cookieName);
  if (!line) return null;
  const parsed = parseCookiePair(line);
  return parsed?.value ?? null;
}

function cookieAttribute(setCookieLine: string, attribute: string): string | null {
  const segments = setCookieLine.split(';').map((segment) => segment.trim());
  const target = attribute.toLowerCase();
  for (const segment of segments.slice(1)) {
    const [key, ...rest] = segment.split('=');
    if (key.toLowerCase() !== target) continue;
    return rest.length > 0 ? rest.join('=') : '';
  }
  return null;
}

function mergeCookieJar(jar: CookieJar, setCookieLines: string[]): void {
  for (const line of setCookieLines) {
    const parsed = parseCookiePair(line);
    if (!parsed) continue;
    if (parsed.value === '') {
      jar.delete(parsed.name);
    } else {
      jar.set(parsed.name, parsed.value);
    }
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function createAuthE2EContext(): Promise<AuthE2EContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  return { app, db };
}

async function createLocalUser(db: Db, overrides?: Partial<Omit<LocalUserCredentials, 'userId'>>): Promise<LocalUserCredentials> {
  const suffix = randomUUID().replace(/-/g, '');
  const password = overrides?.password ?? 'AuthUser123';
  const username = overrides?.username ?? `auth-user-${suffix}`;
  const email = overrides?.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await db
    .insert(schema.users)
    .values({
      username,
      name: `Auth User ${suffix}`,
      email,
      passwordHash,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  return {
    userId: created.id,
    username,
    password,
    email,
  };
}

async function findRefreshTokenByRawToken(db: Db, rawToken: string) {
  return db.query.refreshTokens.findFirst({
    where: eq(schema.refreshTokens.tokenHash, sha256(rawToken)),
  });
}

async function activeSessionCount(db: Db, userId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.refreshTokens.id })
    .from(schema.refreshTokens)
    .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt), gt(schema.refreshTokens.expiresAt, new Date())));
  return rows.length;
}

async function login(app: NestFastifyApplication, username: string, password: string): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });

  expect(response.statusCode).toBe(200);
  const body = response.json() as { accessToken: string; user: { id: number } };
  const setCookieLines = getSetCookieLines(response.headers);
  const refreshToken = cookieValue(setCookieLines, 'refresh_token');
  expect(refreshToken).toBeTruthy();

  const jar: CookieJar = new Map();
  mergeCookieJar(jar, setCookieLines);

  return {
    userId: body.user.id,
    accessToken: body.accessToken,
    refreshToken: refreshToken!,
    jar,
  };
}

describe('Auth session security (e2e)', () => {
  let context: AuthE2EContext;

  beforeAll(async () => {
    context = await createAuthE2EContext();
  });

  afterAll(async () => {
    await context.app.close();
  });

  describe('setup + login', () => {
    it('completes initial setup and issues auth cookies', async () => {
      const statusBefore = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/setup-status',
      });

      expect(statusBefore.statusCode).toBe(200);
      const beforeBody = statusBefore.json() as { needsSetup: boolean };
      if (!beforeBody.needsSetup) {
        return;
      }

      const setupResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: ADMIN_SETUP_DTO,
      });

      expect(setupResponse.statusCode).toBe(201);
      const setupBody = setupResponse.json() as { accessToken: string; user: { username: string; email: string } };
      expect(setupBody.accessToken).toEqual(expect.any(String));
      expect(setupBody.user).toMatchObject({
        username: ADMIN_SETUP_DTO.username,
        email: ADMIN_SETUP_DTO.email,
      });

      const setupCookies = getSetCookieLines(setupResponse.headers);
      const refreshCookieLine = findCookieLine(setupCookies, 'refresh_token');
      const accessCookieLine = findCookieLine(setupCookies, 'access_token');
      expect(refreshCookieLine).toBeDefined();
      expect(accessCookieLine).toBeDefined();
      expect(cookieAttribute(refreshCookieLine!, 'path')).toBe('/api/v1/auth');
      expect(cookieAttribute(refreshCookieLine!, 'httponly')).toBe('');
      expect(cookieAttribute(refreshCookieLine!, 'samesite')).toBe('Strict');
      expect(cookieAttribute(accessCookieLine!, 'path')).toBe('/api');
      expect(cookieAttribute(accessCookieLine!, 'httponly')).toBe('');
      expect(cookieAttribute(accessCookieLine!, 'samesite')).toBe('Lax');

      const statusAfter = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/setup-status',
      });

      expect(statusAfter.statusCode).toBe(200);
      expect(statusAfter.json()).toEqual({ needsSetup: false });
    });

    it('rejects setup when already completed', async () => {
      const setupAgain = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: {
          ...ADMIN_SETUP_DTO,
          username: 'another-admin',
          email: 'another-admin@example.com',
        },
      });

      expect(setupAgain.statusCode).toBe(409);
    });

    it('allows admin login and rejects invalid credentials', async () => {
      const credentials = await createLocalUser(context.db, { password: 'AuthUserLogin123' });

      const loginResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: credentials.username,
          password: credentials.password,
        },
      });

      expect(loginResponse.statusCode).toBe(200);
      expect(loginResponse.json()).toMatchObject({
        user: {
          username: credentials.username,
        },
      });

      const loginCookies = getSetCookieLines(loginResponse.headers);
      expect(cookieValue(loginCookies, 'refresh_token')).toEqual(expect.any(String));
      expect(cookieValue(loginCookies, 'access_token')).toEqual(expect.any(String));

      const invalidLoginResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: credentials.username,
          password: 'WrongPass123',
        },
      });

      expect(invalidLoginResponse.statusCode).toBe(401);
      expect(getSetCookieLines(invalidLoginResponse.headers)).toHaveLength(0);
    });
  });

  describe('refresh failure paths', () => {
    it('rejects refresh without cookie', async () => {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects refresh with unknown token', async () => {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: 'refresh_token=unknown-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects refresh with expired token and clears the refresh cookie', async () => {
      const credentials = await createLocalUser(context.db);
      const loginResult = await login(context.app, credentials.username, credentials.password);
      const tokenRow = await findRefreshTokenByRawToken(context.db, loginResult.refreshToken);
      expect(tokenRow).toBeDefined();

      await context.db
        .update(schema.refreshTokens)
        .set({ createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.refreshTokens.id, tokenRow!.id));

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${loginResult.refreshToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const responseCookies = getSetCookieLines(response.headers);
      expect(cookieValue(responseCookies, 'refresh_token')).toBe('');
      expect(cookieValue(responseCookies, 'access_token')).toBeNull();
    });

    it('rejects refresh for disabled users and clears both auth cookies', async () => {
      const credentials = await createLocalUser(context.db);
      const loginResult = await login(context.app, credentials.username, credentials.password);

      await context.db.update(schema.users).set({ active: false }).where(eq(schema.users.id, credentials.userId));

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: cookieHeader(loginResult.jar),
        },
      });

      expect(response.statusCode).toBe(401);
      const responseCookies = getSetCookieLines(response.headers);
      expect(cookieValue(responseCookies, 'refresh_token')).toBe('');
      expect(cookieValue(responseCookies, 'access_token')).toBe('');

      const tokenRow = await findRefreshTokenByRawToken(context.db, loginResult.refreshToken);
      expect(tokenRow?.revokedAt).toBeNull();

      const meResponse = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
        },
      });
      expect(meResponse.statusCode).toBe(401);
    });
  });

  describe('refresh rotation', () => {
    it('rotates refresh tokens and revokes the previous token', async () => {
      const credentials = await createLocalUser(context.db);
      const loginResult = await login(context.app, credentials.username, credentials.password);

      expect(await activeSessionCount(context.db, credentials.userId)).toBe(1);

      const refreshResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: cookieHeader(loginResult.jar),
        },
      });

      expect(refreshResponse.statusCode).toBe(200);
      const refreshBody = refreshResponse.json() as { accessToken: string };
      expect(refreshBody.accessToken).toEqual(expect.any(String));

      const refreshCookies = getSetCookieLines(refreshResponse.headers);
      const rotatedRefreshToken = cookieValue(refreshCookies, 'refresh_token');
      expect(rotatedRefreshToken).toBeTruthy();
      expect(rotatedRefreshToken).not.toBe(loginResult.refreshToken);

      mergeCookieJar(loginResult.jar, refreshCookies);

      const oldTokenRow = await findRefreshTokenByRawToken(context.db, loginResult.refreshToken);
      expect(oldTokenRow?.revokedAt).not.toBeNull();

      const newTokenRow = await findRefreshTokenByRawToken(context.db, rotatedRefreshToken!);
      expect(newTokenRow?.userId).toBe(credentials.userId);
      expect(newTokenRow?.revokedAt).toBeNull();
      expect(await activeSessionCount(context.db, credentials.userId)).toBe(1);
    });
  });

  describe('revoked refresh token reuse', () => {
    it('revokes all sessions and invalidates access tokens when a revoked token is reused', async () => {
      const credentials = await createLocalUser(context.db);
      const initialLogin = await login(context.app, credentials.username, credentials.password);
      const revokedRefreshToken = initialLogin.refreshToken;

      const rotateResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: cookieHeader(initialLogin.jar),
        },
      });

      expect(rotateResponse.statusCode).toBe(200);
      const rotatedAccessToken = (rotateResponse.json() as { accessToken: string }).accessToken;

      const reuseResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${revokedRefreshToken}`,
        },
      });

      expect(reuseResponse.statusCode).toBe(401);
      const reuseCookies = getSetCookieLines(reuseResponse.headers);
      expect(cookieValue(reuseCookies, 'refresh_token')).toBe('');
      expect(cookieValue(reuseCookies, 'access_token')).toBe('');

      const remainingSessions = await context.db
        .select({ id: schema.refreshTokens.id })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.userId, credentials.userId));
      expect(remainingSessions).toHaveLength(0);

      const [userAfterReuse] = await context.db
        .select({ tokenVersion: schema.users.tokenVersion })
        .from(schema.users)
        .where(eq(schema.users.id, credentials.userId))
        .limit(1);
      expect(userAfterReuse?.tokenVersion).toBeGreaterThan(1);

      const meResponse = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${rotatedAccessToken}`,
        },
      });

      expect(meResponse.statusCode).toBe(401);
    });
  });

  describe('logout', () => {
    it('clears auth cookies even when no refresh cookie is present', async () => {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({});
      const responseCookies = getSetCookieLines(response.headers);
      expect(cookieValue(responseCookies, 'refresh_token')).toBe('');
      expect(cookieValue(responseCookies, 'access_token')).toBe('');
    });

    it('does not revoke active sessions when logout receives an unknown refresh token', async () => {
      const credentials = await createLocalUser(context.db);
      const loginResult = await login(context.app, credentials.username, credentials.password);

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: 'refresh_token=unknown-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({});
      const responseCookies = getSetCookieLines(response.headers);
      expect(cookieValue(responseCookies, 'refresh_token')).toBe('');
      expect(cookieValue(responseCookies, 'access_token')).toBe('');

      const refreshResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${loginResult.refreshToken}`,
        },
      });
      expect(refreshResponse.statusCode).toBe(200);
    });

    it('clears cookies, revokes refresh token, and blocks refresh/access reuse', async () => {
      const credentials = await createLocalUser(context.db);
      const loginResult = await login(context.app, credentials.username, credentials.password);

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: cookieHeader(loginResult.jar),
        },
      });

      expect(logoutResponse.statusCode).toBe(200);
      const logoutCookies = getSetCookieLines(logoutResponse.headers);
      expect(cookieValue(logoutCookies, 'refresh_token')).toBe('');
      expect(cookieValue(logoutCookies, 'access_token')).toBe('');

      const tokenRow = await findRefreshTokenByRawToken(context.db, loginResult.refreshToken);
      expect(tokenRow?.revokedAt).not.toBeNull();

      const refreshAfterLogout = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${loginResult.refreshToken}`,
        },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);

      const meAfterLogout = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
        },
      });
      expect(meAfterLogout.statusCode).toBe(401);
    });
  });

  describe('change password', () => {
    it('revokes active sessions and requires new credentials', async () => {
      const credentials = await createLocalUser(context.db, { password: 'OldPass123' });
      const sessionA = await login(context.app, credentials.username, credentials.password);
      const sessionB = await login(context.app, credentials.username, credentials.password);
      const nextPassword = 'NewPass123';

      expect(await activeSessionCount(context.db, credentials.userId)).toBe(2);

      const changePasswordResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: {
          authorization: `Bearer ${sessionA.accessToken}`,
          cookie: cookieHeader(sessionA.jar),
        },
        payload: {
          currentPassword: credentials.password,
          newPassword: nextPassword,
        },
      });

      expect(changePasswordResponse.statusCode).toBe(204);
      const changeCookies = getSetCookieLines(changePasswordResponse.headers);
      expect(cookieValue(changeCookies, 'refresh_token')).toBe('');
      expect(cookieValue(changeCookies, 'access_token')).toBe('');
      expect(await activeSessionCount(context.db, credentials.userId)).toBe(0);

      const oldPasswordLogin = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: credentials.username,
          password: credentials.password,
        },
      });
      expect(oldPasswordLogin.statusCode).toBe(401);

      const newPasswordLogin = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: credentials.username,
          password: nextPassword,
        },
      });
      expect(newPasswordLogin.statusCode).toBe(200);

      const refreshAfterPasswordChange = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${sessionB.refreshToken}`,
        },
      });
      expect(refreshAfterPasswordChange.statusCode).toBe(401);
    }, 15_000);

    it('keeps sessions active when current password is invalid', async () => {
      const credentials = await createLocalUser(context.db, { password: 'OldPass123' });
      const loginResult = await login(context.app, credentials.username, credentials.password);

      const changePasswordResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
          cookie: cookieHeader(loginResult.jar),
        },
        payload: {
          currentPassword: 'WrongOldPass123',
          newPassword: 'NewPass123',
        },
      });

      expect(changePasswordResponse.statusCode).toBe(401);
      expect(await activeSessionCount(context.db, credentials.userId)).toBe(1);

      const refreshResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${loginResult.refreshToken}`,
        },
      });
      expect(refreshResponse.statusCode).toBe(200);
    }, 15_000);
  });

  describe('session revocation endpoint', () => {
    it('revokes target session only and enforces ownership', async () => {
      const owner = await createLocalUser(context.db, { password: 'OwnerPass123' });
      const sessionA = await login(context.app, owner.username, owner.password);
      const sessionB = await login(context.app, owner.username, owner.password);

      const sessionARow = await findRefreshTokenByRawToken(context.db, sessionA.refreshToken);
      const sessionBRow = await findRefreshTokenByRawToken(context.db, sessionB.refreshToken);
      expect(sessionARow).toBeDefined();
      expect(sessionBRow).toBeDefined();

      const sessionsResponse = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: {
          authorization: `Bearer ${sessionA.accessToken}`,
        },
      });

      expect(sessionsResponse.statusCode).toBe(200);
      const sessions = sessionsResponse.json() as Array<{ id: number }>;
      expect(sessions.map((session) => session.id)).toEqual(expect.arrayContaining([sessionARow!.id, sessionBRow!.id]));

      const revokeResponse = await context.app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/sessions/${sessionARow!.id}`,
        headers: {
          authorization: `Bearer ${sessionB.accessToken}`,
        },
      });
      expect(revokeResponse.statusCode).toBe(204);

      const sessionsAfterRevoke = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: {
          authorization: `Bearer ${sessionB.accessToken}`,
        },
      });
      expect(sessionsAfterRevoke.statusCode).toBe(200);
      const activeSessionIds = (sessionsAfterRevoke.json() as Array<{ id: number }>).map((session) => session.id);
      expect(activeSessionIds).toContain(sessionBRow!.id);
      expect(activeSessionIds).not.toContain(sessionARow!.id);

      const otherUser = await createLocalUser(context.db, { password: 'OtherPass123' });
      const otherSession = await login(context.app, otherUser.username, otherUser.password);
      const forbiddenResponse = await context.app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/sessions/${sessionBRow!.id}`,
        headers: {
          authorization: `Bearer ${otherSession.accessToken}`,
        },
      });
      expect(forbiddenResponse.statusCode).toBe(403);

      const missingSessionResponse = await context.app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/sessions/999999',
        headers: {
          authorization: `Bearer ${sessionB.accessToken}`,
        },
      });
      expect(missingSessionResponse.statusCode).toBe(404);

      const activeSessionRefresh = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${sessionB.refreshToken}`,
        },
      });
      expect(activeSessionRefresh.statusCode).toBe(200);

      const revokedSessionRefresh = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${sessionA.refreshToken}`,
        },
      });
      expect(revokedSessionRefresh.statusCode).toBe(401);
    }, 15_000);
  });
});
