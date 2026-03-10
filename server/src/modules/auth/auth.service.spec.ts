import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

function makeDb(overrides?: Record<string, unknown>) {
  const db: Record<string, unknown> = {
    query: {
      appSettings: { findFirst: jest.fn() },
      refreshTokens: { findFirst: jest.fn(), findMany: jest.fn() },
      users: { findFirst: jest.fn() },
      passwordResetTokens: { findFirst: jest.fn() },
    },
    $count: jest.fn().mockResolvedValue(0),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([]),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockResolvedValue([{ total: 0 }]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockReturnThis(),
    transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { ...db, ...overrides } as never;
}

function makeReply() {
  return {
    setCookie: jest.fn(),
  } as never;
}

function makeRequest(cookies: Record<string, string> = {}) {
  return { cookies, headers: {} } as never;
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
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findByIdWithPermissions: jest.fn(),
    create: jest.fn(),
    incrementTokenVersion: jest.fn().mockResolvedValue(undefined),
    generatePasswordResetToken: jest.fn().mockResolvedValue('raw-reset-token'),
  };
  const jwtService = {
    sign: jest.fn().mockReturnValue('signed-jwt'),
  };
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'auth.jwtRefreshExpiresIn') return '7d';
      if (key === 'auth.jwtExpiresIn') return '15m';
      if (key === 'app.nodeEnv') return 'test';
      if (key === 'auth.setupBootstrapToken') return 'bootstrap-token';
      return undefined;
    }),
  };
  const mailerService = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getOidcConfig: jest.fn().mockResolvedValue({ enabled: false }),
  };
  const oidcSessionRepo = {
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    revokeByUserId: jest.fn().mockResolvedValue(undefined),
  };
  const oidcDiscovery = {
    getDiscoveryDoc: jest.fn(),
  };

  const service = new AuthService(
    userService as never,
    jwtService as never,
    config as never,
    mailerService as never,
    appSettings as never,
    oidcSessionRepo as never,
    oidcDiscovery as never,
    db,
  );

  return { service, db, userService, jwtService, config, mailerService, appSettings, oidcSessionRepo, oidcDiscovery };
}

describe('AuthService', () => {
  describe('setupStatus', () => {
    it('returns needsSetup=true when there are no users', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).$count as jest.Mock).mockResolvedValue(0);

      await expect(service.setupStatus()).resolves.toEqual({ needsSetup: true });
    });

    it('returns needsSetup=false when at least one user exists', async () => {
      const { service, db } = makeService();
      ((db as unknown as Record<string, unknown>).$count as jest.Mock).mockResolvedValue(1);

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
      ((db as unknown as Record<string, unknown>).returning as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        service.setup({ username: 'admin', name: 'Admin', email: 'admin@example.com', password: 'Admin1234' } as never, undefined, makeReply()),
      ).rejects.toThrow(ConflictException);
    });

    it('creates initial admin and returns auth payload', async () => {
      const { service, db, userService } = makeService();
      const reply = makeReply();

      ((db as unknown as Record<string, unknown>).returning as jest.Mock)
        .mockResolvedValueOnce([{ id: 99 }])
        .mockResolvedValueOnce([{ id: 7, tokenVersion: 1 }]);
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValue(null);
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
        undefined,
        reply,
      );

      expect(result).toMatchObject({
        accessToken: 'signed-jwt',
        user: { id: 7, username: 'owner', email: 'owner@example.com' },
      });
      expect((reply as unknown as { setCookie: jest.Mock }).setCookie).toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('throws ForbiddenException when registration is closed', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'false' });

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: undefined } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when username already exists', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValueOnce({ id: 99, username: 'existing' });

      await expect(service.register({ username: 'existing', name: 'E', password: 'P@ssw0rd!', email: undefined } as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when email already in use', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 88, email: 'existing@example.com' });

      await expect(
        service.register({ username: 'newuser', name: 'N', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('registers user successfully', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValueOnce(null);
      ((db as unknown as Record<string, unknown>).returning as jest.Mock).mockResolvedValueOnce([{ id: 1, username: 'jdoe', name: 'John Doe' }]);

      const result = await service.register({ username: 'jdoe', name: 'John Doe', password: 'P@ssw0rd!', email: undefined } as never);
      expect(result).toEqual({ id: 1, username: 'jdoe', name: 'John Doe' });
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
        active: true,
        passwordHash: '$2b$12$invalidhash',
        tokenVersion: 1,
      });

      await expect(service.login({ username: 'jdoe', password: 'wrongpass' }, makeReply())).rejects.toThrow(UnauthorizedException);
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
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue(null);

      await expect(service.refresh(makeRequest({ refresh_token: 'unknown-token' }), makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException and revokes all sessions when revoked token is reused', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'revoked-token' }), makeReply())).rejects.toThrow(UnauthorizedException);
      expect(db.delete).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when token is expired', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(makeRequest({ refresh_token: 'expired-token' }), makeReply())).rejects.toThrow(UnauthorizedException);
    });

    it('rotates token and sets cookies when refresh succeeds', async () => {
      const { service, db } = makeService();
      const reply = makeReply();
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 11,
        userId: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValue({
        id: 5,
        tokenVersion: 2,
        active: true,
      });

      const result = await service.refresh(makeRequest({ refresh_token: 'ok-token' }), reply);
      expect(result).toEqual({ accessToken: 'signed-jwt' });
      expect(db.update).toHaveBeenCalled();
      expect((reply as unknown as { setCookie: jest.Mock }).setCookie).toHaveBeenCalled();
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
  });

  describe('forgotPassword', () => {
    it('throws ServiceUnavailableException when mailer is not configured', async () => {
      const { service, mailerService } = makeService();
      mailerService.isConfigured.mockReturnValue(false);

      await expect(service.forgotPassword({ email: 'u@example.com' })).rejects.toThrow(ServiceUnavailableException);
    });

    it('silently returns when email is not found (no user enumeration)', async () => {
      const { service, userService } = makeService();
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.forgotPassword({ email: 'ghost@example.com' })).resolves.toBeUndefined();
    });

    it('sends reset email when user exists', async () => {
      const { service, userService, mailerService } = makeService();
      userService.findByEmail.mockResolvedValue({ id: 1, email: 'u@example.com', name: 'User' });

      await service.forgotPassword({ email: 'u@example.com' });
      expect(mailerService.sendPasswordReset).toHaveBeenCalledWith('u@example.com', 'User', 'raw-reset-token');
    });
  });

  describe('changePassword', () => {
    it('throws UnauthorizedException when user not found', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValue(null);

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws BadRequestException for OIDC-provisioned users', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValue({
        id: 1,
        provisioningMethod: 'oidc',
        passwordHash: 'hash',
      });

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).users.findFirst.mockResolvedValue({
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
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findMany.mockResolvedValue([
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
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue({
        id: 9,
        userId: 999,
      });

      await expect(service.revokeSession(1, 9)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException when reset token is expired', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() - 10_000),
        usedAt: null,
      });

      await expect(service.resetPassword({ token: 'expired', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reset token is already used', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).passwordResetTokens.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 10_000),
        usedAt: new Date(),
      });

      await expect(service.resetPassword({ token: 'used', newPassword: 'NewPassword1' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('logout', () => {
    it('returns empty object when no refresh cookie', async () => {
      const { service } = makeService();
      const result = await service.logout(makeRequest(), makeReply());
      expect(result).toEqual({});
    });

    it('returns empty object when OIDC is disabled', async () => {
      const { service, db, userService, appSettings } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findFirst.mockResolvedValue({ id: 1, userId: 5 });
      userService.incrementTokenVersion.mockResolvedValue(undefined);
      appSettings.getOidcConfig.mockResolvedValue({ enabled: false });

      const result = await service.logout(makeRequest({ refresh_token: 'some-token' }), makeReply());
      expect(result).toEqual({});
    });
  });
});
