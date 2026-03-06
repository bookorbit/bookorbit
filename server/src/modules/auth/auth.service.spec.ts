import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

function makeDb(overrides?: Partial<ReturnType<typeof makeDb>>) {
  const db: Record<string, unknown> = {
    query: {
      appSettings: { findFirst: jest.fn() },
      refreshTokens: { findFirst: jest.fn(), findMany: jest.fn() },
      users: { findFirst: jest.fn() },
      roles: { findFirst: jest.fn() },
      passwordResetTokens: { findFirst: jest.fn() },
    },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockReturnThis(),
    transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      };
      return fn(tx);
    }),
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
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    roles: [
      {
        id: 1,
        name: 'User',
        description: '',
        isSuperuser: false,
        isSystem: true,
        permissions: [{ id: 1, name: 'read_books' }],
      },
    ],
    ...overrides,
  } as never;
}

function makeService(dbOverrides?: Partial<ReturnType<typeof makeDb>>) {
  const db = makeDb(dbOverrides);
  const userService = {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findByIdWithRolesAndPermissions: jest.fn(),
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
  describe('register', () => {
    it('throws ForbiddenException when registration is closed', async () => {
      const { service, db } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'false' });

      await expect(service.register({ username: 'u', name: 'U', password: 'P@ssw0rd!', email: undefined } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when username already exists', async () => {
      const { service, db, userService } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      userService.findByUsername.mockResolvedValue({ id: 99, username: 'existing' });

      await expect(service.register({ username: 'existing', name: 'E', password: 'P@ssw0rd!', email: undefined } as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when email already in use', async () => {
      const { service, db, userService } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      userService.findByUsername.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue({ id: 88, email: 'existing@example.com' });

      await expect(
        service.register({ username: 'newuser', name: 'N', password: 'P@ssw0rd!', email: 'existing@example.com' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('registers user successfully and assigns User role', async () => {
      const { service, db, userService } = makeService();
      (db.query as never as Record<string, Record<string, jest.Mock>>).appSettings.findFirst.mockResolvedValue({ value: 'true' });
      userService.findByUsername.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue({ id: 1, username: 'jdoe', name: 'John Doe' });
      (db.query as never as Record<string, Record<string, jest.Mock>>).roles.findFirst.mockResolvedValue({ id: 5, name: 'User' });
      (db.insert as jest.Mock).mockReturnThis();
      (db.values as jest.Mock).mockResolvedValue(undefined);

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
      // bcryptjs hash for a different password
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
      const user = makeFullUser({
        roles: [{ id: 1, name: 'Admin', description: '', isSuperuser: true, isSystem: true, permissions: [] }],
      });

      const response = service.buildUserResponse(user as never);
      expect(response.permissions).toEqual(['*']);
    });

    it('deduplicates permissions across multiple roles', () => {
      const { service } = makeService();
      const user = makeFullUser({
        roles: [
          { id: 1, name: 'Editor', description: '', isSuperuser: false, isSystem: false, permissions: [{ id: 1, name: 'read_books' }] },
          {
            id: 2,
            name: 'Uploader',
            description: '',
            isSuperuser: false,
            isSystem: false,
            permissions: [
              { id: 1, name: 'read_books' },
              { id: 2, name: 'upload_books' },
            ],
          },
        ],
      });

      const response = service.buildUserResponse(user as never);
      expect(response.permissions).toEqual(['read_books', 'upload_books']);
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
      // Should delete all user sessions
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
  });

  describe('validateUser', () => {
    it('throws UnauthorizedException when user not found', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithRolesAndPermissions.mockResolvedValue(null);

      await expect(service.validateUser(1, 1)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithRolesAndPermissions.mockResolvedValue(makeFullUser({ active: false }));

      await expect(service.validateUser(1, 1)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when tokenVersion does not match', async () => {
      const { service, userService } = makeService();
      userService.findByIdWithRolesAndPermissions.mockResolvedValue(makeFullUser({ tokenVersion: 5 }));

      await expect(service.validateUser(1, 3)).rejects.toThrow(UnauthorizedException);
    });

    it('returns user when all checks pass', async () => {
      const { service, userService } = makeService();
      const user = makeFullUser({ tokenVersion: 2 });
      userService.findByIdWithRolesAndPermissions.mockResolvedValue(user);

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

      await expect(service.changePassword(1, { currentPassword: 'old', newPassword: 'New@1234' }, makeReply())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSessions', () => {
    it('filters out expired sessions', async () => {
      const { service, db } = makeService();
      const now = new Date();
      (db.query as never as Record<string, Record<string, jest.Mock>>).refreshTokens.findMany.mockResolvedValue([
        { id: 1, createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000) },
        { id: 2, createdAt: new Date(now.getTime() - 2000), expiresAt: new Date(now.getTime() - 1000) },
      ]);

      const sessions = await service.getSessions(1);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(1);
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
