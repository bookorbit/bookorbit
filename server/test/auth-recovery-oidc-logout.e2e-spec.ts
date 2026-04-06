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
import { OidcDiscoveryService } from '../src/modules/auth/oidc/oidc-discovery.service';
import { SystemMailService } from '../src/modules/email/system-mail.service';
import { makeMetadataNoopMock, type Db } from './e2e/app-harness';

type CookieJar = Map<string, string>;

interface AuthRecoveryContext {
  app: NestFastifyApplication;
  db: Db;
  systemMailMock: {
    isConfigured: ReturnType<typeof vi.fn>;
    sendPasswordReset: ReturnType<typeof vi.fn>;
  };
  oidcDiscoveryMock: {
    getDiscoveryDoc: ReturnType<typeof vi.fn>;
  };
}

interface LocalUserCredentials {
  userId: number;
  username: string;
  password: string;
  email: string;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  jar: CookieJar;
}

const ADMIN_SETUP_DTO = {
  username: 'recovery-e2e-admin',
  name: 'Recovery E2E Admin',
  email: 'recovery-e2e-admin@example.com',
  password: 'RecoveryAdmin123',
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

function cookieValue(setCookieLines: string[], cookieName: string): string | null {
  const line = setCookieLines.find((entry) => entry.startsWith(`${cookieName}=`));
  if (!line) return null;
  const parsed = parseCookiePair(line);
  return parsed?.value ?? null;
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

function defaultDiscoveryDoc() {
  return {
    issuer: 'https://issuer.example',
    authorizationEndpoint: 'https://issuer.example/auth',
    tokenEndpoint: 'https://issuer.example/token',
    jwksUri: 'https://issuer.example/jwks',
    userinfoEndpoint: 'https://issuer.example/userinfo',
    endSessionEndpoint: 'https://issuer.example/logout',
    backchannelLogoutSupported: true,
  };
}

async function createAuthRecoveryContext(): Promise<AuthRecoveryContext> {
  const systemMailMock = {
    isConfigured: vi.fn().mockResolvedValue(true),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
  };
  const oidcDiscoveryMock = {
    getDiscoveryDoc: vi.fn().mockResolvedValue(defaultDiscoveryDoc()),
  };

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
    .overrideProvider(SystemMailService)
    .useValue(systemMailMock)
    .overrideProvider(OidcDiscoveryService)
    .useValue(oidcDiscoveryMock)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  return { app, db, systemMailMock, oidcDiscoveryMock };
}

async function ensureInitialSetup(app: NestFastifyApplication): Promise<void> {
  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/setup-status',
  });
  expect(statusResponse.statusCode).toBe(200);
  const statusBody = statusResponse.json() as { needsSetup: boolean };
  if (!statusBody.needsSetup) return;

  const setupResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });
  expect(setupResponse.statusCode).toBe(201);
}

async function createUser(
  db: Db,
  options?: {
    password?: string;
    provisioningMethod?: 'local' | 'oidc';
    active?: boolean;
  },
): Promise<LocalUserCredentials> {
  const suffix = randomUUID().replace(/-/g, '');
  const password = options?.password ?? 'AuthUser123';
  const username = `auth-recovery-${suffix}`;
  const email = `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await db
    .insert(schema.users)
    .values({
      username,
      name: `Auth Recovery ${suffix}`,
      email,
      passwordHash,
      active: options?.active ?? true,
      provisioningMethod: options?.provisioningMethod ?? 'local',
      isDefaultPassword: false,
    })
    .returning({ id: schema.users.id });

  return {
    userId: created.id,
    username,
    password,
    email,
  };
}

async function login(app: NestFastifyApplication, username: string, password: string): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);

  const body = response.json() as { accessToken: string };
  const setCookieLines = getSetCookieLines(response.headers);
  const refreshToken = cookieValue(setCookieLines, 'refresh_token');
  expect(refreshToken).toBeTruthy();

  const jar: CookieJar = new Map();
  mergeCookieJar(jar, setCookieLines);

  return {
    accessToken: body.accessToken,
    refreshToken: refreshToken!,
    jar,
  };
}

async function waitForExpectation(assertion: () => void, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function latestResetTokenFromMail(context: AuthRecoveryContext): string {
  const token = context.systemMailMock.sendPasswordReset.mock.calls.at(-1)?.[2];
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Password reset token was not captured by the mail mock');
  }
  return token;
}

async function passwordResetTokenCount(db: Db): Promise<number> {
  const rows = await db.select({ id: schema.passwordResetTokens.id }).from(schema.passwordResetTokens);
  return rows.length;
}

async function waitForStablePasswordResetTokenCount(db: Db, expected: number, stableMs = 300, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  let latestCount = -1;

  while (Date.now() < deadline) {
    latestCount = await passwordResetTokenCount(db);
    if (latestCount === expected) {
      if (stableSince === null) {
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) {
        return;
      }
    } else {
      stableSince = null;
    }

    await sleep(50);
  }

  throw new Error(`Password reset token count was not stable at ${expected}. Last count: ${latestCount}`);
}

async function activeSessionCount(db: Db, userId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.refreshTokens.id })
    .from(schema.refreshTokens)
    .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt), gt(schema.refreshTokens.expiresAt, new Date())));
  return rows.length;
}

async function setOidcEnabledConfig(db: Db, issuerUri = 'https://issuer.example'): Promise<void> {
  const value = JSON.stringify({
    enabled: true,
    providerName: 'Example OIDC',
    issuerUri,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scopes: 'openid profile email',
    claimMapping: {
      username: 'preferred_username',
      name: 'name',
      email: 'email',
      groups: 'groups',
    },
    autoProvision: {
      enabled: false,
      allowLocalLinking: true,
      defaultPermissionNames: [],
    },
  });

  await db.insert(schema.appSettings).values({ key: 'oidc_config', value }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

describe('Auth recovery and OIDC logout hardening (e2e)', () => {
  let context: AuthRecoveryContext;

  beforeAll(async () => {
    context = await createAuthRecoveryContext();
    await ensureInitialSetup(context.app);
  });

  beforeEach(() => {
    context.systemMailMock.isConfigured.mockReset();
    context.systemMailMock.isConfigured.mockResolvedValue(true);
    context.systemMailMock.sendPasswordReset.mockClear();
    context.oidcDiscoveryMock.getDiscoveryDoc.mockReset();
    context.oidcDiscoveryMock.getDiscoveryDoc.mockResolvedValue(defaultDiscoveryDoc());
  });

  afterAll(async () => {
    await context.app.close();
  });

  describe('forgot/reset password', () => {
    it('issues reset token, resets password, and revokes active sessions', async () => {
      const user = await createUser(context.db, { password: 'OldPass123' });
      const session = await login(context.app, user.username, user.password);

      const forgotResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: user.email },
      });
      expect(forgotResponse.statusCode).toBe(200);

      await waitForExpectation(() => {
        expect(context.systemMailMock.sendPasswordReset).toHaveBeenCalledTimes(1);
      });

      const rawToken = latestResetTokenFromMail(context);
      const tokenRowBeforeReset = await context.db.query.passwordResetTokens.findFirst({
        where: eq(schema.passwordResetTokens.tokenHash, sha256(rawToken)),
      });
      expect(tokenRowBeforeReset?.userId).toBe(user.userId);
      expect(tokenRowBeforeReset?.usedAt).toBeNull();

      const resetResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: rawToken,
          newPassword: 'NewPass123',
        },
      });
      expect(resetResponse.statusCode).toBe(204);

      const oldPasswordLogin = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: user.username,
          password: user.password,
        },
      });
      expect(oldPasswordLogin.statusCode).toBe(401);

      const newPasswordLogin = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: user.username,
          password: 'NewPass123',
        },
      });
      expect(newPasswordLogin.statusCode).toBe(200);
      expect(await activeSessionCount(context.db, user.userId)).toBe(1);
      const newAccessToken = (newPasswordLogin.json() as { accessToken: string }).accessToken;

      const refreshAfterReset = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${session.refreshToken}`,
        },
      });
      expect(refreshAfterReset.statusCode).toBe(401);
      expect(await activeSessionCount(context.db, user.userId)).toBe(0);

      const meAfterRevokedReuse = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${newAccessToken}`,
        },
      });
      expect(meAfterRevokedReuse.statusCode).toBe(401);

      const tokenRowAfterReset = await context.db.query.passwordResetTokens.findFirst({
        where: eq(schema.passwordResetTokens.tokenHash, sha256(rawToken)),
      });
      expect(tokenRowAfterReset?.usedAt).not.toBeNull();
    });

    it('rejects reset token reuse after successful password reset', async () => {
      const user = await createUser(context.db);

      const forgotResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: user.email },
      });
      expect(forgotResponse.statusCode).toBe(200);

      await waitForExpectation(() => {
        expect(context.systemMailMock.sendPasswordReset).toHaveBeenCalledTimes(1);
      });

      const rawToken = latestResetTokenFromMail(context);
      const firstReset = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: rawToken,
          newPassword: 'ReuseCheck123',
        },
      });
      expect(firstReset.statusCode).toBe(204);

      const secondReset = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: rawToken,
          newPassword: 'ReuseCheck456',
        },
      });
      expect(secondReset.statusCode).toBe(400);
    });

    it('returns success but does not issue token for unknown or OIDC users', async () => {
      const tokenCountBefore = await passwordResetTokenCount(context.db);

      const unknownEmailResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: `missing-${randomUUID()}@example.com` },
      });
      expect(unknownEmailResponse.statusCode).toBe(200);

      const oidcUser = await createUser(context.db, { provisioningMethod: 'oidc' });
      const oidcForgotResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: oidcUser.email },
      });
      expect(oidcForgotResponse.statusCode).toBe(200);

      await waitForStablePasswordResetTokenCount(context.db, tokenCountBefore);
      expect(context.systemMailMock.sendPasswordReset).not.toHaveBeenCalled();

      const tokenCountAfter = await passwordResetTokenCount(context.db);
      expect(tokenCountAfter).toBe(tokenCountBefore);
    });

    it('returns success but does not issue token for inactive local users', async () => {
      const tokenCountBefore = await passwordResetTokenCount(context.db);
      const inactiveUser = await createUser(context.db, { active: false, provisioningMethod: 'local' });

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: inactiveUser.email },
      });
      expect(response.statusCode).toBe(200);

      await waitForStablePasswordResetTokenCount(context.db, tokenCountBefore);
      expect(context.systemMailMock.sendPasswordReset).not.toHaveBeenCalled();

      const tokenRowsForUser = await context.db
        .select({ id: schema.passwordResetTokens.id })
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, inactiveUser.userId));
      expect(tokenRowsForUser).toHaveLength(0);
    });

    it('returns 503 when self-service mail is not configured', async () => {
      context.systemMailMock.isConfigured.mockResolvedValueOnce(false);

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: `config-check-${randomUUID()}@example.com` },
      });
      expect(response.statusCode).toBe(503);
    });

    it('rejects invalid and expired reset tokens', async () => {
      const invalidTokenResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: `invalid-${randomUUID()}`,
          newPassword: 'NewPass123',
        },
      });
      expect(invalidTokenResponse.statusCode).toBe(400);

      const user = await createUser(context.db);
      const expiredToken = `expired-${randomUUID()}`;
      await context.db.insert(schema.passwordResetTokens).values({
        userId: user.userId,
        tokenHash: sha256(expiredToken),
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      });

      const expiredTokenResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: expiredToken,
          newPassword: 'NewPass123',
        },
      });
      expect(expiredTokenResponse.statusCode).toBe(400);
    });

    it('rejects reset tokens for inactive and OIDC users', async () => {
      const inactiveUser = await createUser(context.db, { active: false, provisioningMethod: 'local' });
      const inactiveUserToken = `inactive-${randomUUID()}`;
      await context.db.insert(schema.passwordResetTokens).values({
        userId: inactiveUser.userId,
        tokenHash: sha256(inactiveUserToken),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const inactiveResetResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: inactiveUserToken,
          newPassword: 'NewPass123',
        },
      });
      expect(inactiveResetResponse.statusCode).toBe(400);

      const oidcUser = await createUser(context.db, { provisioningMethod: 'oidc' });
      const oidcUserToken = `oidc-${randomUUID()}`;
      await context.db.insert(schema.passwordResetTokens).values({
        userId: oidcUser.userId,
        tokenHash: sha256(oidcUserToken),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const oidcResetResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          token: oidcUserToken,
          newPassword: 'NewPass123',
        },
      });
      expect(oidcResetResponse.statusCode).toBe(400);

      const inactiveTokenRow = await context.db.query.passwordResetTokens.findFirst({
        where: eq(schema.passwordResetTokens.tokenHash, sha256(inactiveUserToken)),
      });
      expect(inactiveTokenRow?.usedAt).toBeNull();

      const oidcTokenRow = await context.db.query.passwordResetTokens.findFirst({
        where: eq(schema.passwordResetTokens.tokenHash, sha256(oidcUserToken)),
      });
      expect(oidcTokenRow?.usedAt).toBeNull();
    });
  });

  describe('OIDC logout', () => {
    it('clears cookies and revokes session for local user without OIDC session', async () => {
      const user = await createUser(context.db);
      const session = await login(context.app, user.username, user.password);

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: cookieHeader(session.jar) },
      });
      expect(logoutResponse.statusCode).toBe(200);
      expect(logoutResponse.json()).toEqual({});

      const logoutCookies = getSetCookieLines(logoutResponse.headers);
      expect(cookieValue(logoutCookies, 'refresh_token')).toBe('');
      expect(cookieValue(logoutCookies, 'access_token')).toBe('');

      const refreshAfterLogout = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: `refresh_token=${session.refreshToken}` },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);
    });

    it('returns provider logout URL and revokes local OIDC session', async () => {
      const user = await createUser(context.db);
      const session = await login(context.app, user.username, user.password);

      await setOidcEnabledConfig(context.db);
      const [createdOidcSession] = await context.db
        .insert(schema.oidcSessions)
        .values({
          userId: user.userId,
          oidcSubject: `sub-${randomUUID()}`,
          oidcIssuer: 'https://issuer.example',
          oidcSessionId: `sid-${randomUUID()}`,
          idTokenHint: `id-token-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: schema.oidcSessions.id, idTokenHint: schema.oidcSessions.idTokenHint });

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: cookieHeader(session.jar),
          origin: 'http://localhost:5173',
        },
      });
      expect(logoutResponse.statusCode).toBe(200);

      const body = logoutResponse.json() as { logoutUrl?: string };
      expect(body.logoutUrl).toEqual(expect.any(String));
      const logoutUrl = new URL(body.logoutUrl!);
      expect(`${logoutUrl.origin}${logoutUrl.pathname}`).toBe('https://issuer.example/logout');
      expect(logoutUrl.searchParams.get('id_token_hint')).toBe(createdOidcSession.idTokenHint);
      expect(logoutUrl.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/login');
      const logoutCookies = getSetCookieLines(logoutResponse.headers);
      expect(cookieValue(logoutCookies, 'refresh_token')).toBe('');
      expect(cookieValue(logoutCookies, 'access_token')).toBe('');

      const oidcSessionAfter = await context.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.id, createdOidcSession.id),
      });
      expect(oidcSessionAfter?.revoked).toBe(true);

      const refreshAfterLogout = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${session.refreshToken}`,
        },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);

      const meAfterLogout = await context.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${session.accessToken}`,
        },
      });
      expect(meAfterLogout.statusCode).toBe(401);
    });

    it('revokes local OIDC session even when id token hint is missing', async () => {
      const user = await createUser(context.db);
      const session = await login(context.app, user.username, user.password);
      await setOidcEnabledConfig(context.db);

      const [createdOidcSession] = await context.db
        .insert(schema.oidcSessions)
        .values({
          userId: user.userId,
          oidcSubject: `sub-${randomUUID()}`,
          oidcIssuer: 'https://issuer.example',
          oidcSessionId: `sid-${randomUUID()}`,
          idTokenHint: null,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: schema.oidcSessions.id });

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: cookieHeader(session.jar),
        },
      });

      expect(logoutResponse.statusCode).toBe(200);
      expect(logoutResponse.json()).toEqual({});

      const oidcSessionAfter = await context.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.id, createdOidcSession.id),
      });
      expect(oidcSessionAfter?.revoked).toBe(true);
    });

    it('still revokes local OIDC session when end-session endpoint is unavailable', async () => {
      const user = await createUser(context.db);
      const session = await login(context.app, user.username, user.password);
      await setOidcEnabledConfig(context.db);

      const [createdOidcSession] = await context.db
        .insert(schema.oidcSessions)
        .values({
          userId: user.userId,
          oidcSubject: `sub-${randomUUID()}`,
          oidcIssuer: 'https://issuer.example',
          oidcSessionId: `sid-${randomUUID()}`,
          idTokenHint: `id-token-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: schema.oidcSessions.id });

      context.oidcDiscoveryMock.getDiscoveryDoc.mockResolvedValue({
        ...defaultDiscoveryDoc(),
        endSessionEndpoint: undefined,
      });

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: cookieHeader(session.jar),
        },
      });
      expect(logoutResponse.statusCode).toBe(200);
      expect(logoutResponse.json()).toEqual({});

      const oidcSessionAfter = await context.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.id, createdOidcSession.id),
      });
      expect(oidcSessionAfter?.revoked).toBe(true);
    });

    it('still revokes local OIDC session when discovery lookup fails', async () => {
      const user = await createUser(context.db);
      const session = await login(context.app, user.username, user.password);
      await setOidcEnabledConfig(context.db);

      const [createdOidcSession] = await context.db
        .insert(schema.oidcSessions)
        .values({
          userId: user.userId,
          oidcSubject: `sub-${randomUUID()}`,
          oidcIssuer: 'https://issuer.example',
          oidcSessionId: `sid-${randomUUID()}`,
          idTokenHint: `id-token-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: schema.oidcSessions.id });

      context.oidcDiscoveryMock.getDiscoveryDoc.mockRejectedValueOnce(new Error('discovery unavailable'));

      const logoutResponse = await context.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: cookieHeader(session.jar),
        },
      });
      expect(logoutResponse.statusCode).toBe(200);
      expect(logoutResponse.json()).toEqual({});

      const oidcSessionAfter = await context.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.id, createdOidcSession.id),
      });
      expect(oidcSessionAfter?.revoked).toBe(true);
    });
  });
});
