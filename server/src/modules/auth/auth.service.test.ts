import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';

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
  } as never;
}

function makeRequest(cookies: Record<string, string> = {}, headers: Record<string, string | string[]> = {}) {
  return { cookies, headers, raw: { socket: {} } } as never;
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
  const jwtService = {
    sign: vi.fn().mockReturnValue('signed-jwt'),
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
  };
  const oidcSessionRepo = {
    findActiveByUserId: vi.fn().mockResolvedValue(null),
    revokeByUserId: vi.fn().mockResolvedValue(undefined),
    touchActiveByUserId: vi.fn().mockResolvedValue(undefined),
  };
  const oidcDiscovery = {
    getDiscoveryDoc: vi.fn(),
  };

  const magicLinkRepo = {
    hasActiveByUserId: vi.fn().mockResolvedValue(true),
    countActiveByUserId: vi.fn().mockResolvedValue(0),
  };

  const service = new AuthService(
    userService as never,
    jwtService as never,
    config as never,
    systemMailService as never,
    oidcSessionRepo as never,
    oidcDiscovery as never,
    { emit: vi.fn() } as never,
    magicLinkRepo as never,
    appSettings as never,
    db,
  );

  return { service, db, userService, jwtService, config, systemMailService, appSettings, oidcSessionRepo, oidcDiscovery, magicLinkRepo };
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

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: true });
    });

    it('returns needsSetup=false when at least one user exists', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).$count as vi.Mock).mockResolvedValue(1);

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: false });
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
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'false' });

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: 'u@example.com' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when username already exists', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce({ id: 99, username: 'existing' });

      await expect(
        service.register({ username: 'existing', name: 'E', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when email already in use', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 88, email: 'existing@example.com' });

      await expect(
        service.register({ username: 'newuser', name: 'N', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('registers user successfully', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      ((db as unknown as Record<string, unknown>).returning as vi.Mock).mockResolvedValueOnce([{ id: 1, username: 'jdoe', name: 'John Doe' }]);

      const result = await service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: 'jdoe@example.com' } as never);
      expect(result).toEqual({ id: 1, username: 'jdoe', name: 'John Doe' });
    });

    it('grants configured default library access to self-registered users', async () => {
      const { service, db, appSettings } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
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

    it('records successful primary authentication timestamps', async () => {
      const { service, db, userService } = makeService();
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

      await service.login({ username: 'jdoe', password: 'pass' }, makeReply());

      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
          lastAuthenticatedAt: expect.any(Date),
        }),
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

  describe('refresh', () => {
    it('throws UnauthorizedException when no cookie present', async () => {
      const { service } = makeService();
      await expect(service.refresh(makeRequest(), makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token not found in db', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue(null);

      await expect(service.refresh(makeRequest({ refresh_token: 'unknown-token' }), makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('returns access-only success for a recently rotated token reuse', async () => {
      const { service, db, jwtService } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 7,
        active: true,
        provisioningMethod: 'local',
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'recently-rotated-token' }), reply)).resolves.toEqual({ accessToken: 'signed-jwt' });

      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 5, ver: 7 });
      expect(db.transaction).not.toHaveBeenCalled();
      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith(expect.objectContaining({ lastAuthenticatedAt: expect.any(Date) }));
      expect(db.delete).not.toHaveBeenCalled();

      const setCookieCalls = (reply as unknown as { setCookie: vi.Mock }).setCookie.mock.calls;
      expect(setCookieCalls.map(([name]) => name)).toEqual(['access_token']);
      expect(setCookieCalls[0]).toEqual(['access_token', 'signed-jwt', expect.objectContaining({ path: '/api', maxAge: 900 })]);
    });

    it('does not resurrect a recently rotated token after its replacement session is revoked', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 100_000),
        });

      await expect(service.refresh(makeRequest({ refresh_token: 'recently-rotated-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect(db.transaction).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        '',
        expect.objectContaining({ path: '/api', maxAge: 0 }),
      );
    });

    it('does not accept a recently revoked token unless it was revoked by refresh rotation', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'revoked-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect(db.update).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        '',
        expect.objectContaining({ path: '/api', maxAge: 0 }),
      );
    });

    it('revokes all sessions when a rotated token is reused after the grace window', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date(Date.now() - 31_000);
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        revokedAt: rotatedAt,
        rotatedAt,
        replacedByTokenHash: 'replacement-hash',
        expiresAt: new Date(Date.now() + 100_000),
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'old-rotated-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect(db.transaction).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        '',
        expect.objectContaining({ path: '/api', maxAge: 0 }),
      );
    });

    it('rejects a recently rotated token reuse for disabled users and clears cookies', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 7,
        active: false,
        provisioningMethod: 'local',
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'recently-rotated-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        '',
        expect.objectContaining({ path: '/api', maxAge: 0 }),
      );
    });

    it('rejects a recently rotated shared-user token reuse when all magic links are revoked', async () => {
      const { service, db, magicLinkRepo } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 7,
        active: true,
        provisioningMethod: 'shared',
      });
      magicLinkRepo.hasActiveByUserId.mockResolvedValue(false);

      await expect(service.refresh(makeRequest({ refresh_token: 'recently-rotated-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect(db.transaction).toHaveBeenCalled();
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 }),
      );
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalledWith(
        'access_token',
        '',
        expect.objectContaining({ path: '/api', maxAge: 0 }),
      );
    });

    it('returns access-only success across a chained rotation (N -> N+1 -> live N+2) within grace', async () => {
      const { service, db, jwtService } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date(Date.now() - 5_000);
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        // 1st findFirst: the presented (oldest) token, already rotated to hash-1
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'hash-1',
          expiresAt: new Date(Date.now() + 100_000),
        })
        // 2nd findFirst: intermediate link, itself rotated to hash-2 (revoked-but-rotated => keep walking)
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: new Date(Date.now() - 1_000),
          rotatedAt: new Date(Date.now() - 1_000),
          replacedByTokenHash: 'hash-2',
          expiresAt: new Date(Date.now() + 100_000),
        })
        // 3rd findFirst: final live row
        .mockResolvedValueOnce({
          id: 3,
          userId: 5,
          revokedAt: null,
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 9,
        active: true,
        provisioningMethod: 'local',
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'oldest-token' }), reply)).resolves.toEqual({ accessToken: 'signed-jwt' });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 5, ver: 9 });
      expect(db.transaction).not.toHaveBeenCalled();
      const setCookieCalls = (reply as unknown as { setCookie: vi.Mock }).setCookie.mock.calls;
      expect(setCookieCalls.map(([name]) => name)).toEqual(['access_token']);
    });

    it('treats a chain that ends in a logout-revoked link (no rotatedAt) as theft', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      const rotatedAt = new Date(Date.now() - 5_000);
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'hash-1',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: new Date(),
          rotatedAt: null, // <- explicitly logged out, not rotated
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        });

      await expect(service.refresh(makeRequest({ refresh_token: 'oldest-token' }), reply)).rejects.toThrow(UnauthorizedException);
      expect(db.transaction).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
    });

    it('falls back to access-only when the rotation UPDATE matches zero rows AND re-fetch confirms rotation', async () => {
      const { service, db, jwtService } = makeService();
      const reply = makeReply();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        // 1st: refresh() initial lookup - presented token still looks live in our snapshot.
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: null,
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        })
        // 2nd: re-fetch after rowCount=0 — concurrent rotation winner already flipped the row.
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: new Date(),
          rotatedAt: new Date(),
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        // 3rd: chain walk inside isRecentRefreshRotationReuse — replacement is live.
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: null,
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 3,
        active: true,
        provisioningMethod: 'local',
      });
      // Simulate the racing competitor: our UPDATE matches 0 rows.
      (db.where as vi.Mock).mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.refresh(makeRequest({ refresh_token: 'racing-token' }), reply)).resolves.toEqual({ accessToken: 'signed-jwt' });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 5, ver: 3 });
      // No refresh cookie was set on the race-loser path
      const setCookieCalls = (reply as unknown as { setCookie: vi.Mock }).setCookie.mock.calls;
      expect(setCookieCalls.map(([name]) => name)).toEqual(['access_token']);
    });

    it('rejects (and does NOT issue an access token) when the concurrent revoke was a logout, not a rotation', async () => {
      const { service, db, jwtService } = makeService();
      const reply = makeReply();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        // 1st: initial lookup - token still appears live to us.
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: null,
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        })
        // 2nd: re-fetch after rowCount=0 — concurrent LOGOUT revoked the row (rotatedAt is null).
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: new Date(),
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 3,
        active: true,
        provisioningMethod: 'local',
      });
      (db.where as vi.Mock).mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.refresh(makeRequest({ refresh_token: 'racing-token' }), reply)).rejects.toThrow(UnauthorizedException);
      // CRITICAL: no access token cookie set, both cookies cleared (maxAge: 0).
      // (jwtService.sign may have been called speculatively before the transaction lost the race,
      //  but the resulting token must NEVER be sent to the client.)
      const setCookieCalls = (reply as unknown as { setCookie: vi.Mock }).setCookie.mock.calls;
      expect(setCookieCalls.map(([name]) => name)).toEqual(['refresh_token', 'access_token']);
      expect(setCookieCalls[0]).toEqual(['refresh_token', '', expect.objectContaining({ path: '/api/v1/auth', maxAge: 0 })]);
      expect(setCookieCalls[1]).toEqual(['access_token', '', expect.objectContaining({ path: '/api', maxAge: 0 })]);
      // No setCookie call ever emitted a non-empty access token value.
      const accessTokenSetCalls = setCookieCalls.filter(([name, value]) => name === 'access_token' && value !== '');
      expect(accessTokenSetCalls).toHaveLength(0);
      void jwtService;
    });

    it('honours refreshRotationGraceMs from config when widened', async () => {
      const { service, db, config, jwtService } = makeService();
      (config.get as vi.Mock).mockImplementation((key: string) => {
        if (key === 'auth.jwtRefreshExpiresIn') return '7d';
        if (key === 'auth.jwtExpiresIn') return '15m';
        if (key === 'auth.refreshRotationGraceMs') return 120_000; // widen to 2m
        if (key === 'app.nodeEnv') return 'test';
        return undefined;
      });
      const reply = makeReply();
      const rotatedAt = new Date(Date.now() - 90_000); // outside default 30s window, inside widened 120s
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst
        .mockResolvedValueOnce({
          id: 1,
          userId: 5,
          revokedAt: rotatedAt,
          rotatedAt,
          replacedByTokenHash: 'replacement-hash',
          expiresAt: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 5,
          revokedAt: null,
          rotatedAt: null,
          replacedByTokenHash: null,
          expiresAt: new Date(Date.now() + 100_000),
        });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 4,
        active: true,
        provisioningMethod: 'local',
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'widened-grace-token' }), reply)).resolves.toEqual({ accessToken: 'signed-jwt' });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 5, ver: 4 });
    });

    it('throws UnauthorizedException when token is expired', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'expired-token' }), makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('rotates token and sets cookies when refresh succeeds', async () => {
      const { service, db, oidcSessionRepo } = makeService();
      const reply = makeReply();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 11,
        userId: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      (db.query as never as Record<string, Record<string, vi.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 2,
        active: true,
      });

      const result = await service.refresh(makeRequest({ refresh_token: 'ok-token' }), reply);
      expect(result).toEqual({ accessToken: 'signed-jwt' });
      expect(db.transaction).toHaveBeenCalled();
      const rotationSetArg = (db as unknown as Record<string, vi.Mock>).set.mock.calls[0]?.[0] as { revokedAt?: Date; rotatedAt?: Date };
      expect(rotationSetArg.revokedAt).toBeInstanceOf(Date);
      expect(rotationSetArg.rotatedAt).toBe(rotationSetArg.revokedAt);
      expect(rotationSetArg).toEqual(expect.objectContaining({ replacedByTokenHash: expect.any(String) }));
      expect((db as unknown as Record<string, vi.Mock>).set).toHaveBeenCalledWith(expect.objectContaining({ lastAuthenticatedAt: expect.any(Date) }));
      expect(oidcSessionRepo.touchActiveByUserId).toHaveBeenCalledWith(5, expect.any(Date));
      expect((reply as unknown as { setCookie: vi.Mock }).setCookie).toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
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
  });

  describe('getSessions', () => {
    it('returns active sessions', async () => {
      const { service, db } = makeService();
      const now = new Date();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findMany.mockResolvedValue([
        { id: 1, createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000) },
      ]);

      const sessions = await service.getSessions(1);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(1);
    });
  });

  describe('revokeSession', () => {
    it('throws ForbiddenException when session belongs to another user', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({
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
  });

  describe('logout', () => {
    it('returns empty object when no refresh cookie', async () => {
      const { service } = makeService();
      const result = await service.logout(makeRequest(), makeReply());
      expect(result).toEqual({});
    });

    it('revokes OIDC session and returns empty object when OIDC is disabled', async () => {
      const { service, db, userService, appSettings, oidcSessionRepo } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({ id: 1, userId: 5 });
      userService.incrementTokenVersion.mockResolvedValue(undefined);
      appSettings.getOidcConfig.mockResolvedValue({ enabled: false });
      oidcSessionRepo.findActiveByUserId.mockResolvedValue({
        idTokenHint: 'id-token-hint',
      });

      const result = await service.logout(makeRequest({ refresh_token: 'some-token' }), makeReply());
      expect(result).toEqual({});
      expect(oidcSessionRepo.revokeByUserId).toHaveBeenCalledWith(5);
    });

    it('revokes OIDC session even when there is no id token hint', async () => {
      const { service, db, userService, oidcSessionRepo } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({ id: 1, userId: 6 });
      userService.incrementTokenVersion.mockResolvedValue(undefined);
      oidcSessionRepo.findActiveByUserId.mockResolvedValue({
        idTokenHint: null,
      });

      const result = await service.logout(makeRequest({ refresh_token: 'some-token' }), makeReply());
      expect(result).toEqual({});
      expect(oidcSessionRepo.revokeByUserId).toHaveBeenCalledWith(6);
    });

    it('returns logout URL when OIDC end-session endpoint is available', async () => {
      const { service, db, userService, oidcSessionRepo, oidcDiscovery } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({ id: 1, userId: 7 });
      userService.incrementTokenVersion.mockResolvedValue(undefined);
      (db.query as never as Record<string, Record<string, vi.Mock>>).oidcProviders.findFirst.mockResolvedValue({
        id: 1,
        enabled: true,
        issuerUri: 'https://issuer.example',
      });
      oidcSessionRepo.findActiveByUserId.mockResolvedValue({
        providerId: 1,
        idTokenHint: 'id-token-hint',
      });
      oidcDiscovery.getDiscoveryDoc.mockResolvedValue({
        authorizationEndpoint: 'https://issuer.example/auth',
        tokenEndpoint: 'https://issuer.example/token',
        userinfoEndpoint: 'https://issuer.example/userinfo',
        jwksUri: 'https://issuer.example/jwks',
        issuer: 'https://issuer.example',
        endSessionEndpoint: 'https://issuer.example/logout',
      });

      const request = makeRequest({ refresh_token: 'some-token' });
      request.headers.origin = 'http://localhost:5173';

      const result = await service.logout(request, makeReply());
      expect(result).toEqual({
        logoutUrl: 'https://issuer.example/logout?id_token_hint=id-token-hint&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Flogin',
      });
      expect(oidcSessionRepo.revokeByUserId).toHaveBeenCalledWith(7);
    });

    it('revokes OIDC session and returns empty object when end-session endpoint is missing', async () => {
      const { service, db, userService, oidcSessionRepo, oidcDiscovery } = makeService();
      (db.query as never as Record<string, Record<string, vi.Mock>>).refreshTokens.findFirst.mockResolvedValue({ id: 1, userId: 8 });
      userService.incrementTokenVersion.mockResolvedValue(undefined);
      (db.query as never as Record<string, Record<string, vi.Mock>>).oidcProviders.findFirst.mockResolvedValue({
        id: 1,
        enabled: true,
        issuerUri: 'https://issuer.example',
      });
      oidcSessionRepo.findActiveByUserId.mockResolvedValue({
        providerId: 1,
        idTokenHint: 'id-token-hint',
      });
      oidcDiscovery.getDiscoveryDoc.mockResolvedValue({
        authorizationEndpoint: 'https://issuer.example/auth',
        tokenEndpoint: 'https://issuer.example/token',
        userinfoEndpoint: 'https://issuer.example/userinfo',
        jwksUri: 'https://issuer.example/jwks',
        issuer: 'https://issuer.example',
      });

      const result = await service.logout(makeRequest({ refresh_token: 'some-token' }), makeReply());
      expect(result).toEqual({});
      expect(oidcSessionRepo.revokeByUserId).toHaveBeenCalledWith(8);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('bumps tokenVersion and revokes all refresh tokens in a transaction', async () => {
      const { service, db } = makeService();

      await service.revokeAllUserSessions(5);

      expect(db.transaction).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalled();
    });
  });
});
