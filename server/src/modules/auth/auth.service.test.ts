import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { LoginErrorCode } from '@bookorbit/types';

vi.mock('bcryptjs', () => ({
  hash: vi.fn((value: string) => Promise.resolve(`mock-hash:${value}`)),
  compare: vi.fn((plain: string, hashed: string) => Promise.resolve(hashed === `mock-hash:${plain}`)),
}));

import { AuthService } from './auth.service';

function makeDb(overrides?: Record<string, unknown>) {
  const db: Record<string, unknown> = {
    query: {
      appSettings: { findFirst: vi.fn() },
      refreshTokens: { findFirst: vi.fn(), findMany: vi.fn() },
      users: { findFirst: vi.fn() },
      passwordResetTokens: { findFirst: vi.fn() },
      oidcProviders: { findFirst: vi.fn() },
    },
    $count: vi.fn().mockResolvedValue(0),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockResolvedValue([{ total: 0 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { ...db, ...overrides } as never;
}

function makeReply() {
  return {
    setCookie: vi.fn(),
    header: vi.fn(),
  } as never;
}

function makeFullUser(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    username: 'jdoe',
    name: 'John Doe',
    email: 'jdoe@example.com',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: ['library_download'],
    ...overrides,
  } as never;
}

function makeService(dbOverrides?: Record<string, unknown>) {
  const db = makeDb(dbOverrides);
  const userService = {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findByIdWithPermissions: vi.fn(),
    create: vi.fn(),
    incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
    generatePasswordResetToken: vi.fn().mockResolvedValue('raw-reset-token'),
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'auth.jwtRefreshExpiresIn') return '7d';
      if (key === 'auth.jwtExpiresIn') return '15m';
      if (key === 'app.nodeEnv') return 'test';
      if (key === 'auth.setupBootstrapToken') return 'bootstrap-token';
      if (key === 'auth.refreshRotationGraceMs') return 30_000;
      return undefined;
    }),
  };
  const systemMailService = {
    isConfigured: vi.fn().mockResolvedValue(true),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getOidcConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getDefaultLibraryAccessLibraryIds: vi.fn().mockResolvedValue([]),
    getValue: vi.fn().mockResolvedValue(null),
  };
  const credentials = {
    accessToken: 'signed-jwt',
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: 'a'.repeat(64),
    refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
    sessionId: 1,
  };
  const sessions = { issue: vi.fn().mockResolvedValue(credentials), refresh: vi.fn().mockResolvedValue(credentials) };
  const sessionRepo = { list: vi.fn(), findSession: vi.fn(), revoke: vi.fn(), isActive: vi.fn() };

  const magicLinkRepo = {
    hasActiveByUserId: vi.fn().mockResolvedValue(true),
    countActiveByUserId: vi.fn().mockResolvedValue(0),
  };
  const oidcProviderService = { findEnabled: vi.fn().mockResolvedValue([]) };
  const authenticationPolicy = {
    assertPasswordLoginEnabled: vi.fn(),
    isPasswordLoginEnabled: vi.fn().mockReturnValue(true),
  };

  const service = new AuthService(
    userService as never,
    config as never,
    systemMailService as never,
    { emit: vi.fn() } as never,
    magicLinkRepo as never,
    appSettings as never,
    oidcProviderService as never,
    authenticationPolicy as never,
    sessions as never,
    sessionRepo as never,
    db,
  );

  return {
    service,
    db,
    userService,
    config,
    systemMailService,
    appSettings,
    magicLinkRepo,
    oidcProviderService,
    authenticationPolicy,
    sessions,
    sessionRepo,
  };
}

describe('AuthService', () => {
  describe('cookie transport security', () => {
    it('omits Secure on direct HTTP and adds Secure for trusted-proxy HTTPS', async () => {
      const app = Fastify({ trustProxy: 'loopback,linklocal,uniquelocal' });
      await app.register(fastifyCookie);
      app.get('/cookie', (_request, reply) => {
        reply.setCookie('probe', '1', { path: '/', secure: 'auto' }).send({ ok: true });
      });

      try {
        const directHttp = await app.inject({ method: 'GET', url: '/cookie' });
        expect(String(directHttp.headers['set-cookie'])).not.toContain('Secure');

        const proxiedHttps = await app.inject({
          method: 'GET',
          url: '/cookie',
          headers: { 'x-forwarded-proto': 'https' },
        });
        expect(String(proxiedHttps.headers['set-cookie'])).toContain('Secure');
      } finally {
        await app.close();
      }
    });
  });

  describe('setupStatus', () => {
    it('returns needsSetup=true when there are no users', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).$count as vi.Mock).mockResolvedValue(0);

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: true, allowRegistration: false });
    });

    it('returns needsSetup=false when at least one user exists', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).$count as vi.Mock).mockResolvedValue(1);

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: false, allowRegistration: false });
    });

    it('reports allowRegistration=true when the setting is enabled', async () => {
      const { service, db, appSettings } = makeService();
      ((db as unknown as Record<string, unknown>).$count as vi.Mock).mockResolvedValue(1);
      appSettings.getValue.mockResolvedValue('true');

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: false, allowRegistration: true });
      expect(appSettings.getValue).toHaveBeenCalledWith('allow_registration');
    });

    it('treats an unset or non-boolean registration setting as closed', async () => {
      const { service, db, appSettings } = makeService();
      ((db as unknown as Record<string, unknown>).$count as vi.Mock).mockResolvedValue(1);

      for (const value of [null, '', 'TRUE', 'yes', '1']) {
        appSettings.getValue.mockResolvedValue(value);
        await expect(service.setupStatus()).resolves.toEqual({ needsSetup: false, allowRegistration: false });
      }
    });
  });

  describe('loginOptions', () => {
    it('returns password and registration policy with the enabled OIDC providers atomically', async () => {
      const { service, appSettings, oidcProviderService } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      oidcProviderService.findEnabled.mockResolvedValue([
        { slug: 'sso', displayName: 'SSO', enabled: true, iconUrl: null, clientId: 'client', scopes: 'openid', issuerUri: 'secret' },
      ]);

      await expect(service.loginOptions()).resolves.toEqual({
        passwordLoginEnabled: true,
        allowRegistration: true,
        oidcProviders: [{ slug: 'sso', displayName: 'SSO', enabled: true, iconUrl: null, clientId: 'client', scopes: 'openid' }],
      });
    });

    it('never advertises registration when password authentication is disabled', async () => {
      const { service, appSettings, authenticationPolicy } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      authenticationPolicy.isPasswordLoginEnabled.mockReturnValue(false);

      await expect(service.loginOptions()).resolves.toMatchObject({ passwordLoginEnabled: false, allowRegistration: false });
    });
  });

  describe('setup', () => {
    it('throws ForbiddenException when setup token is invalid in production', async () => {
      const { service, config } = makeService();
      config.get.mockImplementation((key: string) => {
        if (key === 'app.nodeEnv') return 'production';
        if (key === 'auth.setupBootstrapToken') return 'expected-token';
        if (key === 'auth.jwtRefreshExpiresIn') return '7d';
        if (key === 'auth.jwtExpiresIn') return '15m';
        return undefined;
      });

      await expect(
        service.setup({ username: 'admin', name: 'Admin', email: 'admin@example.com', password: 'Admin1234' } as never, 'wrong-token', makeReply()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when setup is already completed', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([]);

      await expect(
        service.setup(
          { username: 'admin', name: 'Admin', email: 'admin@example.com', password: 'Admin1234' } as never,
          'bootstrap-token',
          makeReply(),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates initial admin and returns auth payload', async () => {
      const { service, db, userService } = makeService();
      const reply = makeReply();

      ((db as unknown as Record<string, unknown>).returning as vi.Mock)
        .mockResolvedValueOnce([{ id: 99 }])
        .mockResolvedValueOnce([{ id: 7, tokenVersion: 1 }]);
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue(null);
      userService.findByIdWithPermissions.mockResolvedValue(
        makeFullUser({
          id: 7,
          username: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          isSuperuser: true,
          permissions: [],
        }),
      );

      const result = await service.setup(
        { username: 'owner', name: 'Owner', email: 'owner@example.com', password: 'Owner1234' } as never,
        'bootstrap-token',
        reply,
      );

      expect(result).toMatchObject({
        accessToken: 'signed-jwt',
        user: { id: 7, username: 'owner', email: 'owner@example.com' },
      });
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('throws ForbiddenException when registration is closed', async () => {
      const { service, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('false');

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: 'u@example.com' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the registration setting is missing', async () => {
      const { service, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue(null);

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: 'u@example.com' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not create a user when registration is closed', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('false');

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: 'u@example.com' } as never)).rejects.toThrow(
        ForbiddenException,
      );
      expect((db as unknown as { transaction: vi.Mock }).transaction).not.toHaveBeenCalled();
      expect((db as unknown as { insert: vi.Mock }).insert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when username already exists', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce({ id: 99, username: 'existing' });

      await expect(
        service.register({ username: 'existing', name: 'E', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when email already in use', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 88, email: 'existing@example.com' });

      await expect(
        service.register({ username: 'newuser', name: 'N', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('registers user successfully', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([{ id: 1, username: 'jdoe', name: 'John Doe' }]);

      const result = await service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never);
      expect(result).toEqual({ id: 1, username: 'jdoe', name: 'John Doe' });
    });

    it('reports a conflict when a concurrent signup wins the unique index race', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue(null);
      const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      ((db as unknown as Record<string, unknown>).transaction as vi.Mock).mockRejectedValue(pgError);

      await expect(
        service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('detects a unique violation wrapped as an error cause', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue(null);
      ((db as unknown as Record<string, unknown>).transaction as vi.Mock).mockRejectedValue(new Error('insert failed', { cause: { code: '23505' } }));

      await expect(
        service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('does not mask unrelated database failures as conflicts', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue(null);
      ((db as unknown as Record<string, unknown>).transaction as vi.Mock).mockRejectedValue(
        Object.assign(new Error('connection terminated'), { code: '08006' }),
      );

      await expect(
        service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never),
      ).rejects.toThrow('connection terminated');
    });

    it('never grants superuser or explicit permissions to a self-registered account', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([{ id: 1, username: 'jdoe', name: 'John Doe' }]);

      await service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never);

      const insertedUser = ((db as unknown as { values: vi.Mock }).values.mock.calls[0] as [Record<string, unknown>])[0];
      expect(insertedUser).not.toHaveProperty('isSuperuser');
      expect(insertedUser).not.toHaveProperty('active');
      expect(insertedUser).not.toHaveProperty('provisioningMethod');
      expect(insertedUser.passwordHash).toBe('mock-hash:P@ssw0rd!');
    });

    it('neutralises newlines in the logged username', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      const forged = 'evil\n[auth.login] [end] userId=1 - forged';
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([{ id: 1, username: forged, name: 'Evil' }]);
      const logSpy = vi.spyOn((service as unknown as { logger: { log: (msg: string) => void } }).logger, 'log');

      await service.register({ username: forged, name: 'Evil', password: 'P@ssw0rd!', email: 'evil@example.com' } as never);

      const logged = logSpy.mock.calls.at(-1)?.[0] as string;
      expect(logged).not.toContain('\n');
      expect(logged).toContain('evil [auth.login]');
    });

    it('grants configured default library access to self-registered users', async () => {
      const { service, db, appSettings } = makeService();
      appSettings.getValue.mockResolvedValue('true');
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      appSettings.getDefaultLibraryAccessLibraryIds.mockResolvedValue([2, 4]);
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([{ id: 1, username: 'jdoe', name: 'John Doe' }]);

      await service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never);

      expect((db as unknown as { values: vi.Mock }).values).toHaveBeenCalledWith([
        { userId: 1, libraryId: 2, accessLevel: 'viewer' },
        { userId: 1, libraryId: 4, accessLevel: 'viewer' },
      ]);
    });
  });

  describe('login', () => {
    it('rejects a disabled password login before lookup or lockout mutation', async () => {
      const { service, db, userService, authenticationPolicy } = makeService();
      authenticationPolicy.assertPasswordLoginEnabled.mockImplementation(() => {
        throw new ForbiddenException({ message: 'Password authentication is disabled', errorCode: LoginErrorCode.PASSWORD_AUTH_DISABLED });
      });

      await expect(service.login({ username: 'jdoe', password: 'wrong' }, makeReply())).rejects.toThrow(ForbiddenException);
      expect(userService.findByUsername).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when user not found', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue(null);

      await expect(service.login({ username: 'ghost', password: 'pass' }, makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when account is disabled', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue({ id: 1, active: false, passwordHash: 'hash', tokenVersion: 1 });

      await expect(service.login({ username: 'jdoe', password: 'pass' }, makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: '$2b$12$invalidhash',
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      await expect(service.login({ username: 'jdoe', password: 'wrongpass' }, makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login attempts while account is locked', async () => {
      const { service, db, userService } = makeService();
      const lockedUntil = new Date(Date.now() + 60_000);
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:pass',
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil,
      });

      await expect(service.login({ username: 'jdoe', password: 'pass' }, makeReply())).rejects.toThrow(UnauthorizedException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('reports the lockout with a retry time when the password is correct', async () => {
      const { service, userService } = makeService();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:pass',
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + 5 * 60_000),
      });

      const error = await service.login({ username: 'jdoe', password: 'pass' }, makeReply()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      const response = (error as UnauthorizedException).getResponse() as { errorCode: string; retryAfterSeconds: number };
      expect(response.errorCode).toBe(LoginErrorCode.ACCOUNT_LOCKED);
      expect(response.retryAfterSeconds).toBeGreaterThan(4 * 60);
      expect(response.retryAfterSeconds).toBeLessThanOrEqual(5 * 60);
    });

    it('hides the lockout behind the generic failure when the password is wrong', async () => {
      const { service, db, userService } = makeService();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:correct',
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + 5 * 60_000),
      });

      const error = await service.login({ username: 'jdoe', password: 'wrong' }, makeReply()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).not.toHaveProperty('errorCode');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('increments failed login attempts for wrong password and non-locked account', async () => {
      const { service, db, userService } = makeService();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:correct',
        tokenVersion: 1,
        failedLoginAttempts: 2,
        lockedUntil: null,
      });

      await expect(service.login({ username: 'jdoe', password: 'wrong' }, makeReply())).rejects.toThrow(UnauthorizedException);
      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith({ failedLoginAttempts: 3, lockedUntil: null });
    });

    it('locks account for 15 minutes after five consecutive failed attempts', async () => {
      const { service, db, userService } = makeService();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:correct',
        tokenVersion: 1,
        failedLoginAttempts: 4,
        lockedUntil: null,
      });

      await expect(service.login({ username: 'jdoe', password: 'wrong' }, makeReply())).rejects.toThrow(UnauthorizedException);

      const setArg = (db as unknown as Record<string, vi.Mock>).set.mock.calls.at(-1)?.[0] as {
        failedLoginAttempts: number;
        lockedUntil: Date | null;
      };
      expect(setArg.failedLoginAttempts).toBe(0);
      expect(setArg.lockedUntil).toBeInstanceOf(Date);
      expect(setArg.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    });

    it('clears failed login state after successful authentication', async () => {
      const { service, db, userService } = makeService();
      const reply = makeReply();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        passwordHash: 'mock-hash:pass',
        tokenVersion: 1,
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() - 5_000),
      });
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser());

      await service.login({ username: 'jdoe', password: 'pass' }, reply);

      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith({ failedLoginAttempts: 0, lockedUntil: null });
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalled();
    });

    it('sets auth cookies with automatic Secure mode', async () => {
      const { service, userService } = makeService();
      const reply = makeReply();
      userService.findByUsername.mockResolvedValue({
        id: 1,
        active: true,
        passwordHash: 'mock-hash:pass',
        tokenVersion: 1,
        username: 'jdoe',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser());

      await service.login({ username: 'jdoe', password: 'pass' }, reply);

      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        'signed-jwt',
        expect.objectContaining({ path: '/api', secure: 'auto', sameSite: 'lax' }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.any(String),
        expect.objectContaining({ path: '/api/v1/auth', secure: 'auto' }),
      );
    });
  });

  describe('buildUserResponse', () => {
    it('returns wildcard permissions for superuser', () => {
      const { service } = makeService();
      const user = makeFullUser({ isSuperuser: true, permissions: [] });

      const response = service.buildUserResponse(user as never);
      expect(response.permissions).toEqual(['*']);
    });

    it('returns flat permission list for non-superuser', () => {
      const { service } = makeService();
      const user = makeFullUser({
        isSuperuser: false,
        permissions: ['library_download', 'kobo_sync'],
      });

      const response = service.buildUserResponse(user as never);
      expect(response.permissions).toEqual(['library_download', 'kobo_sync']);
    });

    it('includes all user fields in response', () => {
      const { service } = makeService();
      const user = makeFullUser();
      const response = service.buildUserResponse(user);
      expect(response).toMatchObject({
        id: 1,
        username: 'jdoe',
        name: 'John Doe',
        email: 'jdoe@example.com',
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        provisioningMethod: 'local',
      });
    });
  });

  describe('validateUser', () => {
    it('rejects password and legacy access tokens in SSO-only mode before loading the user', async () => {
      const { service, userService, authenticationPolicy } = makeService();
      authenticationPolicy.isPasswordLoginEnabled.mockReturnValue(false);

      await expect(service.validateUser(1, 1, 'password')).rejects.toThrow(UnauthorizedException);
      await expect(service.validateUser(1, 1, 'legacy')).rejects.toThrow(UnauthorizedException);
      expect(userService.findByIdWithPermissions).not.toHaveBeenCalled();
    });

    it.each(['oidc', 'magic_link'] as const)('accepts an active %s session in SSO-only mode', async (authenticationMethod) => {
      const { service, userService, authenticationPolicy } = makeService();
      authenticationPolicy.isPasswordLoginEnabled.mockReturnValue(false);
      const user = makeFullUser({ tokenVersion: 2 });
      userService.findByIdWithPermissions.mockResolvedValue(user);

      await expect(service.validateUser(1, 2, authenticationMethod)).resolves.toEqual({ ...user, authenticationMethod });
    });

    it('throws UnauthorizedException when user not found', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(null);

      await expect(service.validateUser(1, 1)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ active: false }));

      await expect(service.validateUser(1, 1)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when tokenVersion does not match', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ tokenVersion: 5 }));

      await expect(service.validateUser(1, 3)).rejects.toThrow(UnauthorizedException);
    });

    it('returns user when all checks pass', async () => {
      const { service, userService } = makeService();
      const user = makeFullUser({ tokenVersion: 2 });
      userService.findByIdWithPermissions.mockResolvedValue(user);

      const result = await service.validateUser(1, 2);
      expect(result).toEqual(user);
    });

    it('throws UnauthorizedException for shared user with no active magic links', async () => {
      const { service, userService, magicLinkRepo } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ tokenVersion: 2, provisioningMethod: 'shared' }));
      magicLinkRepo.hasActiveByUserId.mockResolvedValue(false);

      await expect(service.validateUser(1, 2)).rejects.toThrow(UnauthorizedException);
    });

    it('returns shared user when active magic links exist', async () => {
      const { service, userService, magicLinkRepo } = makeService();
      const user = makeFullUser({ tokenVersion: 2, provisioningMethod: 'shared' });
      userService.findByIdWithPermissions.mockResolvedValue(user);
      magicLinkRepo.hasActiveByUserId.mockResolvedValue(true);

      const result = await service.validateUser(1, 2);
      expect(result).toEqual(user);
    });
  });

  /**
   * The resolution a caller acting on somebody's behalf gets. Every rule `validateUser` applies
   * except the token version, which belongs to a token the caller does not hold; the point of the
   * shared helper is that a way in that is closed to a login stays closed to a delegated call.
   */
  describe('findActingUser', () => {
    it('returns null when the user does not exist', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(null);

      await expect(service.findActingUser(1)).resolves.toBeNull();
    });

    it('returns null when the user is deactivated', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ active: false }));

      await expect(service.findActingUser(1)).resolves.toBeNull();
    });

    it('returns null for a shared user whose magic links were all revoked', async () => {
      const { service, userService, magicLinkRepo } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ provisioningMethod: 'shared' }));
      magicLinkRepo.hasActiveByUserId.mockResolvedValue(false);

      await expect(service.findActingUser(1)).resolves.toBeNull();
    });

    it('returns a shared user who still has a live magic link', async () => {
      const { service, userService, magicLinkRepo } = makeService();
      const user = makeFullUser({ provisioningMethod: 'shared' });
      userService.findByIdWithPermissions.mockResolvedValue(user);
      magicLinkRepo.hasActiveByUserId.mockResolvedValue(true);

      await expect(service.findActingUser(1)).resolves.toEqual(user);
    });

    it('never asks about magic links for an ordinary account', async () => {
      const { service, userService, magicLinkRepo } = makeService();
      userService.findByIdWithPermissions.mockResolvedValue(makeFullUser({ provisioningMethod: 'local' }));

      await service.findActingUser(1);
      expect(magicLinkRepo.hasActiveByUserId).not.toHaveBeenCalled();
    });

    it('ignores the token version, which belongs to a token this caller does not hold', async () => {
      const { service, userService } = makeService();
      const user = makeFullUser({ tokenVersion: 9 });
      userService.findByIdWithPermissions.mockResolvedValue(user);

      await expect(service.findActingUser(1)).resolves.toEqual(user);
    });
  });

  describe('forgotPassword', () => {
    it('throws ServiceUnavailableException when system mail is not configured', async () => {
      const { service, systemMailService } = makeService();
      systemMailService.isConfigured.mockResolvedValue(false);

      await expect(service.forgotPassword({ email: 'u@example.com' })).rejects.toThrow(ServiceUnavailableException);
    });

    it('silently returns when email is not found (no user enumeration)', async () => {
      const { service, userService } = makeService();
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.forgotPassword({ email: 'ghost@example.com' })).resolves.toBeUndefined();
    });

    it('sends reset email when user exists', async () => {
      const { service, userService, systemMailService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'u@example.com',
        name: 'User',
        active: true,
        provisioningMethod: 'local',
        username: 'user',
      });

      await service.forgotPassword({ email: 'u@example.com' });
      // fire-and-forget — flush microtasks
      await new Promise((r) => setImmediate(r));
      expect(systemMailService.sendPasswordReset).toHaveBeenCalledWith('u@example.com', 'User', 'raw-reset-token');
    });

    it('silently returns without sending email for inactive user', async () => {
      const { service, userService, systemMailService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'u@example.com',
        name: 'User',
        active: false,
        provisioningMethod: 'local',
        username: 'user',
      });

      await service.forgotPassword({ email: 'u@example.com' });
      await new Promise((r) => setImmediate(r));
      expect(systemMailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('silently returns without sending email for OIDC user', async () => {
      const { service, userService, systemMailService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'u@example.com',
        name: 'User',
        active: true,
        provisioningMethod: 'oidc',
        username: 'user',
      });

      await service.forgotPassword({ email: 'u@example.com' });
      await new Promise((r) => setImmediate(r));
      expect(systemMailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('silently returns without sending email for shared user', async () => {
      const { service, userService, systemMailService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'demo@example.com',
        name: 'Demo',
        active: true,
        provisioningMethod: 'shared',
        username: 'demo',
      });

      await service.forgotPassword({ email: 'demo@example.com' });
      await new Promise((r) => setImmediate(r));
      expect(systemMailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('SEC-028: masks email address in logs for unknown email (no user enumeration via logs)', async () => {
      const { service, userService } = makeService();
      userService.findByEmail.mockResolvedValue(null);
      const logSpy = vi.spyOn((service as never as { logger: { log: vi.Mock } }).logger, 'log');

      await service.forgotPassword({ email: 'alice@example.com' });
      await new Promise((r) => setImmediate(r));

      const loggedMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(loggedMessages.some((m) => m.includes('alice@example.com'))).toBe(false);
      expect(loggedMessages.some((m) => m.includes('a***@example.com'))).toBe(true);
    });

    it('SEC-028: masks email address in logs for inactive account', async () => {
      const { service, userService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'alice@example.com',
        name: 'Alice',
        active: false,
        provisioningMethod: 'local',
        username: 'alice',
      });
      const logSpy = vi.spyOn((service as never as { logger: { log: vi.Mock } }).logger, 'log');

      await service.forgotPassword({ email: 'alice@example.com' });
      await new Promise((r) => setImmediate(r));

      const loggedMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(loggedMessages.some((m) => m.includes('alice@example.com'))).toBe(false);
      expect(loggedMessages.some((m) => m.includes('a***@example.com'))).toBe(true);
    });

    it('SEC-028: masks email address in logs for OIDC account', async () => {
      const { service, userService } = makeService();
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'alice@example.com',
        name: 'Alice',
        active: true,
        provisioningMethod: 'oidc',
        username: 'alice',
      });
      const logSpy = vi.spyOn((service as never as { logger: { log: vi.Mock } }).logger, 'log');

      await service.forgotPassword({ email: 'alice@example.com' });
      await new Promise((r) => setImmediate(r));

      const loggedMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(loggedMessages.some((m) => m.includes('alice@example.com'))).toBe(false);
      expect(loggedMessages.some((m) => m.includes('a***@example.com'))).toBe(true);
    });
  });

  describe('changePassword', () => {
    it('throws UnauthorizedException when user not found', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue(null);

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws BadRequestException for OIDC-provisioned users', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        provisioningMethod: 'oidc',
        passwordHash: 'hash',
      });

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for shared-provisioned users', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        provisioningMethod: 'shared',
        passwordHash: 'hash',
      });

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        provisioningMethod: 'local',
        passwordHash: '$2b$12$N4G7fngl8wXlWv2vN7INzuLe6Qw3sJwN6gI6s2zQm6A2f0r7WQX1y',
      });

      await expect(service.changePassword(1, { currentPassword: 'wrong-current', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('clears an active lockout on success', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        provisioningMethod: 'local',
        passwordHash: 'mock-hash:old',
      });

      await service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply());

      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
      );
    });
  });

  describe('getSessions', () => {
    it('returns active sessions', async () => {
      const { service, sessionRepo } = makeService();
      const now = new Date();
      sessionRepo.list.mockResolvedValue([{ id: 1, createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000) }]);

      const sessions = await service.getSessions(1);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(1);
    });
  });

  describe('revokeSession', () => {
    it('throws ForbiddenException when session belongs to another user', async () => {
      const { service, sessionRepo } = makeService();
      sessionRepo.findSession.mockResolvedValue({
        id: 9,
        userId: 999,
      });

      await expect(service.revokeSession(1, 9)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException when reset token is expired', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() - 10_000),
        usedAt: null,
      });

      await expect(service.resetPassword({ token: 'expired', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reset token is already used', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: new Date(),
      });

      await expect(service.resetPassword({ token: 'used', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for inactive user', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: null,
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: false,
        provisioningMethod: 'local',
      });

      await expect(service.resetPassword({ token: 'valid', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for OIDC user', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: null,
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        provisioningMethod: 'oidc',
      });

      await expect(service.resetPassword({ token: 'valid', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for shared user', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: null,
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        username: 'demo',
        active: true,
        provisioningMethod: 'shared',
      });

      await expect(service.resetPassword({ token: 'valid', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('resets password, marks token used, and revokes sessions on success', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 5,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: null,
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        provisioningMethod: 'local',
      });

      await expect(service.resetPassword({ token: 'valid', newPassword: 'NewPassword1!' })).resolves.toBeUndefined();
      expect(db.transaction).toHaveBeenCalled();
    });

    it('clears an active lockout so the new password works immediately', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 5,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: null,
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        active: true,
        provisioningMethod: 'local',
      });

      await service.resetPassword({ token: 'valid', newPassword: 'NewPassword1!' });

      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
      );
    });
  });
});
