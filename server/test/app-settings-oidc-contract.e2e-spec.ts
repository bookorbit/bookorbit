import { randomUUID } from 'crypto';

import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { Permission } from '@projectx/types';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { DB } from '../src/db';
import * as schema from '../src/db/schema';
import { MetadataService } from '../src/modules/metadata/metadata.service';
import { OidcDiscoveryService } from '../src/modules/auth/oidc/oidc-discovery.service';
import { OidcTokenClientService } from '../src/modules/auth/oidc/oidc-token-client.service';
import { OidcTokenValidatorService } from '../src/modules/auth/oidc/oidc-token-validator.service';
import { makeMetadataNoopMock, type Db } from './e2e/app-harness';

type CookieJar = Map<string, string>;
type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

const ADMIN_SETUP_DTO = {
  username: 'app-settings-oidc-e2e-admin',
  name: 'App Settings OIDC E2E Admin',
  email: 'app-settings-oidc-e2e-admin@example.com',
  password: 'AppSettingsOidcAdmin123',
};

const SCENARIO_TIMEOUT_MS = 60_000;
const DEFAULT_ISSUER = 'https://issuer.example';

interface OidcContractContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  oidcDiscoveryMock: {
    getDiscoveryDoc: ReturnType<typeof vi.fn>;
  };
  oidcTokenClientMock: {
    exchangeCode: ReturnType<typeof vi.fn>;
    fetchUserInfo: ReturnType<typeof vi.fn>;
  };
  oidcTokenValidatorMock: {
    validateIdToken: ReturnType<typeof vi.fn>;
    validateLogoutToken: ReturnType<typeof vi.fn>;
  };
}

type OidcConfigInput = {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimMapping: {
    username: string;
    name: string;
    email: string;
    groups: string;
  };
  autoProvision: {
    enabled: boolean;
    allowLocalLinking: boolean;
    defaultPermissionNames: string[];
  };
};

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

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function buildDiscoveryDoc(issuerUri = DEFAULT_ISSUER) {
  const normalized = issuerUri.replace(/\/$/, '');
  return {
    issuer: normalized,
    authorizationEndpoint: `${normalized}/auth`,
    tokenEndpoint: `${normalized}/token`,
    jwksUri: `${normalized}/jwks`,
    userinfoEndpoint: `${normalized}/userinfo`,
    endSessionEndpoint: `${normalized}/logout`,
    backchannelLogoutSupported: true,
  };
}

function buildDiscoveryResponse(issuerUri = DEFAULT_ISSUER) {
  const normalized = issuerUri.replace(/\/$/, '');
  return {
    issuer: normalized,
    authorization_endpoint: `${normalized}/auth`,
    token_endpoint: `${normalized}/token`,
    jwks_uri: `${normalized}/jwks`,
    userinfo_endpoint: `${normalized}/userinfo`,
    end_session_endpoint: `${normalized}/logout`,
    backchannel_logout_supported: true,
  };
}

function buildOidcConfig(overrides: Partial<OidcConfigInput> = {}): OidcConfigInput {
  return {
    enabled: true,
    providerName: 'Example OIDC',
    issuerUri: DEFAULT_ISSUER,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scopes: 'openid profile email',
    claimMapping: {
      username: 'preferred_username',
      name: 'name',
      email: 'email',
      groups: 'groups',
      ...(overrides.claimMapping ?? {}),
    },
    autoProvision: {
      enabled: true,
      allowLocalLinking: true,
      defaultPermissionNames: [],
      ...(overrides.autoProvision ?? {}),
    },
    ...overrides,
  };
}

function responseMessage(response: { message?: string | string[] }): string {
  if (Array.isArray(response.message)) return response.message.join(' ');
  return String(response.message ?? '');
}

function expectError(response: InjectResponse, status: number, messageFragment?: string): void {
  expect(response.statusCode).toBe(status);
  if (!messageFragment) return;
  expect(responseMessage(response.json() as { message?: string | string[] })).toContain(messageFragment);
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
  return parseCookiePair(line)?.value ?? null;
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

function mockDiscoveryFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.endsWith('/.well-known/openid-configuration')) {
    const issuerUri = url.slice(0, -'/.well-known/openid-configuration'.length);
    return Promise.resolve(
      new Response(JSON.stringify(buildDiscoveryResponse(issuerUri)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
}

async function createOidcContractContext(): Promise<OidcContractContext> {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(mockDiscoveryFetch);

  const oidcDiscoveryMock = {
    getDiscoveryDoc: vi.fn().mockResolvedValue(buildDiscoveryDoc()),
  };
  const oidcTokenClientMock = {
    exchangeCode: vi.fn().mockResolvedValue({ accessToken: 'oidc-access-token', idToken: 'oidc-id-token' }),
    fetchUserInfo: vi.fn().mockResolvedValue({}),
  };
  const oidcTokenValidatorMock = {
    validateIdToken: vi.fn().mockResolvedValue({
      sub: 'oidc-default-subject',
      sid: 'oidc-default-sid',
      preferred_username: 'oidc-default-user',
      name: 'OIDC Default User',
      email: 'oidc-default-user@example.com',
    }),
    validateLogoutToken: vi.fn().mockResolvedValue({
      sub: 'oidc-default-subject',
      sid: 'oidc-default-sid',
      jti: `logout-${randomUUID()}`,
    }),
  };

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
    .overrideProvider(OidcDiscoveryService)
    .useValue(oidcDiscoveryMock)
    .overrideProvider(OidcTokenClientService)
    .useValue(oidcTokenClientMock)
    .overrideProvider(OidcTokenValidatorService)
    .useValue(oidcTokenValidatorMock)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const setupResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });
  expect(setupResponse.statusCode).toBe(201);
  const setupBody = setupResponse.json() as { accessToken: string };

  const db = app.get<Db>(DB);
  return {
    app,
    db,
    adminToken: setupBody.accessToken,
    fetchMock,
    oidcDiscoveryMock,
    oidcTokenClientMock,
    oidcTokenValidatorMock,
  };
}

async function createLocalUser(
  db: Db,
  options: {
    username?: string;
    password?: string;
    active?: boolean;
    email?: string;
  } = {},
): Promise<LocalUserCredentials> {
  const suffix = randomUUID().replace(/-/g, '');
  const username = options.username ?? `oidc-contract-${suffix}`;
  const password = options.password ?? 'OidcContractUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await db
    .insert(schema.users)
    .values({
      username,
      name: `OIDC Contract ${suffix}`,
      email,
      passwordHash,
      active: options.active ?? true,
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

async function putOidcConfig(ctx: OidcContractContext, config: OidcConfigInput): Promise<void> {
  const response = await ctx.app.inject({
    method: 'PUT',
    url: '/api/v1/app-settings/oidc',
    headers: authHeader(ctx.adminToken),
    payload: config,
  });
  expect(response.statusCode).toBe(200);
}

async function issueState(app: NestFastifyApplication): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/oidc/state',
  });
  expect(response.statusCode).toBe(200);
  const body = response.json() as { state: string };
  expect(body.state).toEqual(expect.any(String));
  return body.state;
}

async function activeSessionCount(db: Db, userId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.refreshTokens.id })
    .from(schema.refreshTokens)
    .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt), gt(schema.refreshTokens.expiresAt, new Date())));
  return rows.length;
}

describe('App settings OIDC contract (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: OidcContractContext;

  beforeAll(async () => {
    ctx = await createOidcContractContext();
  });

  beforeEach(() => {
    ctx.fetchMock.mockReset();
    ctx.fetchMock.mockImplementation(mockDiscoveryFetch);
    ctx.oidcDiscoveryMock.getDiscoveryDoc.mockReset();
    ctx.oidcDiscoveryMock.getDiscoveryDoc.mockResolvedValue(buildDiscoveryDoc());
    ctx.oidcTokenClientMock.exchangeCode.mockReset();
    ctx.oidcTokenClientMock.exchangeCode.mockResolvedValue({ accessToken: 'oidc-access-token', idToken: 'oidc-id-token' });
    ctx.oidcTokenClientMock.fetchUserInfo.mockReset();
    ctx.oidcTokenClientMock.fetchUserInfo.mockResolvedValue({});
    ctx.oidcTokenValidatorMock.validateIdToken.mockReset();
    ctx.oidcTokenValidatorMock.validateIdToken.mockResolvedValue({
      sub: 'oidc-default-subject',
      sid: 'oidc-default-sid',
      preferred_username: 'oidc-default-user',
      name: 'OIDC Default User',
      email: 'oidc-default-user@example.com',
    });
    ctx.oidcTokenValidatorMock.validateLogoutToken.mockReset();
    ctx.oidcTokenValidatorMock.validateLogoutToken.mockResolvedValue({
      sub: 'oidc-default-subject',
      sid: 'oidc-default-sid',
      jti: `logout-${randomUUID()}`,
    });
  });

  afterAll(async () => {
    ctx.fetchMock.mockRestore();
    await ctx.app.close();
  });

  describe('OIDC app-settings contract', () => {
    it('stores admin config, exposes the public subset, masks the secret, and tests discovery', async () => {
      const limitedUser = await createLocalUser(ctx.db);
      const limitedSession = await login(ctx.app, limitedUser.username, limitedUser.password);
      const config = buildOidcConfig({
        providerName: 'Contract OIDC',
        autoProvision: {
          enabled: true,
          allowLocalLinking: true,
          defaultPermissionNames: [Permission.KoboSync],
        },
      });

      await putOidcConfig(ctx, config);

      const publicResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/app-settings/oidc/public',
      });
      expect(publicResponse.statusCode).toBe(200);
      expect(publicResponse.json()).toEqual({
        enabled: true,
        providerName: 'Contract OIDC',
        issuerUri: DEFAULT_ISSUER,
        clientId: 'client-id',
        scopes: 'openid profile email',
      });

      const forbiddenResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/app-settings/oidc',
        headers: authHeader(limitedSession.accessToken),
      });
      expect(forbiddenResponse.statusCode).toBe(403);

      const adminResponse = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/app-settings/oidc',
        headers: authHeader(ctx.adminToken),
      });
      expect(adminResponse.statusCode).toBe(200);
      expect(adminResponse.json()).toEqual({
        ...config,
        clientSecret: '***',
      });

      const testResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/app-settings/oidc/test',
        headers: authHeader(ctx.adminToken),
      });
      expect(testResponse.statusCode).toBe(200);
      expect(testResponse.json()).toEqual({
        success: true,
        issuer: DEFAULT_ISSUER,
        authorizationEndpoint: `${DEFAULT_ISSUER}/auth`,
      });
    });
  });

  describe('OIDC callback contract', () => {
    it('issues state, provisions a new OIDC user, sets auth cookies, and consumes state once', async () => {
      const suffix = randomUUID().replace(/-/g, '');
      const username = `oidc-provisioned-${suffix}`;
      const email = `${username}@example.com`;

      await putOidcConfig(
        ctx,
        buildOidcConfig({
          autoProvision: {
            enabled: true,
            allowLocalLinking: false,
            defaultPermissionNames: [Permission.KoboSync],
          },
        }),
      );

      ctx.oidcTokenClientMock.exchangeCode.mockResolvedValueOnce({
        accessToken: 'oidc-access-provisioned',
        idToken: 'oidc-id-provisioned',
      });
      ctx.oidcTokenValidatorMock.validateIdToken.mockResolvedValueOnce({
        sub: 'oidc-provisioned-subject',
        sid: 'oidc-provisioned-sid',
        preferred_username: username,
        name: 'OIDC Provisioned User',
        email,
      });
      ctx.oidcTokenClientMock.fetchUserInfo.mockResolvedValueOnce({
        picture: 'https://issuer.example/avatars/provisioned.png',
      });

      const state = await issueState(ctx.app);
      const callbackPayload = {
        code: 'authorization-code-provisioned',
        codeVerifier: 'verifier-provisioned',
        redirectUri: 'http://localhost:5173/oauth2-callback',
        nonce: 'nonce-provisioned',
        state,
      };

      const callbackResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: callbackPayload,
      });

      expect(callbackResponse.statusCode).toBe(200);
      const callbackBody = callbackResponse.json() as {
        accessToken: string;
        user: {
          id: number;
          username: string;
          email: string;
          provisioningMethod: string;
          avatarUrl: string | null;
          permissions: string[];
        };
      };
      expect(callbackBody.user).toMatchObject({
        username,
        email,
        provisioningMethod: 'oidc',
        avatarUrl: 'https://issuer.example/avatars/provisioned.png',
      });
      expect(callbackBody.user.permissions).toContain(Permission.KoboSync);

      const callbackCookies = getSetCookieLines(callbackResponse.headers);
      const refreshCookieLine = findCookieLine(callbackCookies, 'refresh_token');
      const accessCookieLine = findCookieLine(callbackCookies, 'access_token');
      expect(refreshCookieLine).toBeDefined();
      expect(accessCookieLine).toBeDefined();
      expect(cookieAttribute(refreshCookieLine!, 'path')).toBe('/api/v1/auth');
      expect(cookieAttribute(refreshCookieLine!, 'httponly')).toBe('');
      expect(cookieAttribute(accessCookieLine!, 'path')).toBe('/api');
      expect(cookieAttribute(accessCookieLine!, 'httponly')).toBe('');

      const createdUser = await ctx.db.query.users.findFirst({
        where: eq(schema.users.id, callbackBody.user.id),
      });
      expect(createdUser).toMatchObject({
        username,
        email,
        oidcSubject: 'oidc-provisioned-subject',
        oidcIssuer: DEFAULT_ISSUER,
        provisioningMethod: 'oidc',
      });

      const createdPermissions = await ctx.db.query.userPermissions.findMany({
        where: eq(schema.userPermissions.userId, callbackBody.user.id),
      });
      expect(createdPermissions.map((row) => row.permissionName)).toContain(Permission.KoboSync);

      const oidcSession = await ctx.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.userId, callbackBody.user.id),
      });
      expect(oidcSession).toMatchObject({
        oidcSubject: 'oidc-provisioned-subject',
        oidcIssuer: DEFAULT_ISSUER,
        oidcSessionId: 'oidc-provisioned-sid',
        idTokenHint: 'oidc-id-provisioned',
        revoked: false,
      });

      const reusedState = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: callbackPayload,
      });
      expectError(reusedState, 401, 'Invalid or expired state');
    });

    it('links an existing local user and backchannel logout revokes active sessions only for the matched OIDC identity', async () => {
      const suffix = randomUUID().replace(/-/g, '');
      const linkedUser = await createLocalUser(ctx.db, {
        username: `oidc-linked-${suffix}`,
      });

      await putOidcConfig(
        ctx,
        buildOidcConfig({
          autoProvision: {
            enabled: false,
            allowLocalLinking: true,
            defaultPermissionNames: [],
          },
        }),
      );

      ctx.oidcTokenClientMock.exchangeCode.mockResolvedValueOnce({
        accessToken: 'oidc-access-linked',
        idToken: 'oidc-id-linked',
      });
      ctx.oidcTokenValidatorMock.validateIdToken.mockResolvedValueOnce({
        sub: 'oidc-linked-subject',
        sid: 'oidc-linked-sid',
        preferred_username: linkedUser.username,
        name: 'Linked Local User',
        email: linkedUser.email,
      });

      const state = await issueState(ctx.app);
      const callbackResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: {
          code: 'authorization-code-linked',
          codeVerifier: 'verifier-linked',
          redirectUri: 'http://localhost:5173/oauth2-callback',
          nonce: 'nonce-linked',
          state,
        },
      });

      expect(callbackResponse.statusCode).toBe(200);
      const callbackBody = callbackResponse.json() as {
        accessToken: string;
        user: {
          id: number;
          provisioningMethod: string;
        };
      };
      expect(callbackBody.user).toMatchObject({
        id: linkedUser.userId,
        provisioningMethod: 'local',
      });

      const setCookieLines = getSetCookieLines(callbackResponse.headers);
      const refreshToken = cookieValue(setCookieLines, 'refresh_token');
      expect(refreshToken).toBeTruthy();

      const linkedUserAfter = await ctx.db.query.users.findFirst({
        where: eq(schema.users.id, linkedUser.userId),
      });
      expect(linkedUserAfter).toMatchObject({
        oidcSubject: 'oidc-linked-subject',
        oidcIssuer: DEFAULT_ISSUER,
        provisioningMethod: 'local',
      });

      const sessionBeforeUnknownLogout = await activeSessionCount(ctx.db, linkedUser.userId);
      expect(sessionBeforeUnknownLogout).toBe(1);

      ctx.oidcTokenValidatorMock.validateLogoutToken.mockResolvedValueOnce({
        sub: `oidc-unknown-${randomUUID()}`,
        jti: `logout-unknown-${randomUUID()}`,
      });

      const unknownLogoutResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/backchannel-logout',
        payload: { logout_token: 'unknown-logout-token' },
      });
      expect(unknownLogoutResponse.statusCode).toBe(200);
      expect(await activeSessionCount(ctx.db, linkedUser.userId)).toBe(1);

      const meBeforeMatchedLogout = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(callbackBody.accessToken),
      });
      expect(meBeforeMatchedLogout.statusCode).toBe(200);

      ctx.oidcTokenValidatorMock.validateLogoutToken.mockResolvedValueOnce({
        sub: 'oidc-linked-subject',
        sid: 'oidc-linked-sid',
        jti: `logout-linked-${randomUUID()}`,
      });

      const matchedLogoutResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/backchannel-logout',
        payload: { logout_token: 'matched-logout-token' },
      });
      expect(matchedLogoutResponse.statusCode).toBe(200);

      const oidcSessionAfter = await ctx.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.userId, linkedUser.userId),
      });
      expect(oidcSessionAfter?.revoked).toBe(true);
      expect(await activeSessionCount(ctx.db, linkedUser.userId)).toBe(0);

      const refreshAfterLogout = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${refreshToken}`,
        },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);

      const meAfterLogout = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: authHeader(callbackBody.accessToken),
      });
      expect(meAfterLogout.statusCode).toBe(401);
    });

    it('rejects invalid state and missing subject claims', async () => {
      await putOidcConfig(
        ctx,
        buildOidcConfig({
          autoProvision: {
            enabled: true,
            allowLocalLinking: false,
            defaultPermissionNames: [],
          },
        }),
      );

      const invalidStateResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: {
          code: 'authorization-code-invalid-state',
          codeVerifier: 'verifier-invalid-state',
          redirectUri: 'http://localhost:5173/oauth2-callback',
          nonce: 'nonce-invalid-state',
          state: `invalid-${randomUUID()}`,
        },
      });
      expectError(invalidStateResponse, 401, 'Invalid or expired state');
      expect(ctx.oidcTokenClientMock.exchangeCode).not.toHaveBeenCalled();

      const state = await issueState(ctx.app);
      ctx.oidcTokenValidatorMock.validateIdToken.mockResolvedValueOnce({
        sid: 'oidc-missing-subject-sid',
        preferred_username: `missing-subject-${randomUUID()}`,
        name: 'Missing Subject',
        email: 'missing-subject@example.com',
      });

      const missingSubjectResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: {
          code: 'authorization-code-missing-subject',
          codeVerifier: 'verifier-missing-subject',
          redirectUri: 'http://localhost:5173/oauth2-callback',
          nonce: 'nonce-missing-subject',
          state,
        },
      });
      expectError(missingSubjectResponse, 401, 'Invalid ID token: missing subject claim');
    });

    it('rejects callback when OIDC is disabled or the linked account is deactivated', async () => {
      await putOidcConfig(
        ctx,
        buildOidcConfig({
          enabled: false,
          autoProvision: {
            enabled: true,
            allowLocalLinking: true,
            defaultPermissionNames: [],
          },
        }),
      );

      const disabledState = await issueState(ctx.app);
      const disabledCallbackResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: {
          code: 'authorization-code-disabled',
          codeVerifier: 'verifier-disabled',
          redirectUri: 'http://localhost:5173/oauth2-callback',
          nonce: 'nonce-disabled',
          state: disabledState,
        },
      });
      expectError(disabledCallbackResponse, 401, 'OIDC is not enabled');

      const inactiveUser = await createLocalUser(ctx.db, {
        username: `oidc-inactive-${randomUUID().replace(/-/g, '')}`,
        active: false,
      });

      await putOidcConfig(
        ctx,
        buildOidcConfig({
          enabled: true,
          autoProvision: {
            enabled: false,
            allowLocalLinking: true,
            defaultPermissionNames: [],
          },
        }),
      );

      const inactiveState = await issueState(ctx.app);
      ctx.oidcTokenValidatorMock.validateIdToken.mockResolvedValueOnce({
        sub: 'oidc-inactive-subject',
        sid: 'oidc-inactive-sid',
        preferred_username: inactiveUser.username,
        name: 'Inactive Linked User',
        email: inactiveUser.email,
      });

      const inactiveCallbackResponse = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/oidc/callback',
        payload: {
          code: 'authorization-code-inactive',
          codeVerifier: 'verifier-inactive',
          redirectUri: 'http://localhost:5173/oauth2-callback',
          nonce: 'nonce-inactive',
          state: inactiveState,
        },
      });
      expectError(inactiveCallbackResponse, 401, 'Account is deactivated');

      const inactiveUserSession = await ctx.db.query.oidcSessions.findFirst({
        where: eq(schema.oidcSessions.userId, inactiveUser.userId),
      });
      expect(inactiveUserSession).toBeUndefined();
    });
  });
});
