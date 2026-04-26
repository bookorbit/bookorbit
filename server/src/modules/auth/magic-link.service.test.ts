import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { MagicLinkService } from './magic-link.service';

function makeActor(overrides: Partial<{ id: number; isSuperuser: boolean; username: string }> = {}) {
  return { id: 1, isSuperuser: true, username: 'admin', ...overrides } as never;
}

function makeService() {
  const magicLinkRepo = {
    create: vi.fn().mockResolvedValue({ id: 1, rawToken: 'raw-token-hex', label: 'Demo', expiresAt: null }),
    findByTokenHash: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    countActiveByUserId: vi.fn().mockResolvedValue(0),
    hasActiveByUserId: vi.fn().mockResolvedValue(true),
    setActive: vi.fn(),
    revoke: vi.fn(),
    updateUsage: vi.fn(),
    findById: vi.fn(),
  };

  const userService = {
    findById: vi.fn().mockResolvedValue({ id: 2, provisioningMethod: 'shared', active: true, username: 'demo' }),
  };

  const authService = {
    issueTokensForUser: vi.fn().mockResolvedValue({ accessToken: 'jwt', user: {} }),
    revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
  };

  const auditEvents = { emit: vi.fn() };

  const service = new MagicLinkService(magicLinkRepo as never, userService as never, authService as never, auditEvents as never);

  return { service, magicLinkRepo, userService, authService, auditEvents };
}

describe('MagicLinkService', () => {
  describe('createToken', () => {
    it('throws ForbiddenException for non-superuser', async () => {
      const { service } = makeService();
      await expect(service.createToken(makeActor({ isSuperuser: false }), { userId: 2, label: 'Test' } as never)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for non-shared user', async () => {
      const { service, userService } = makeService();
      userService.findById.mockResolvedValue({ id: 2, provisioningMethod: 'local' });

      await expect(service.createToken(makeActor(), { userId: 2, label: 'Test' } as never)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when max tokens reached', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.countActiveByUserId.mockResolvedValue(5);

      await expect(service.createToken(makeActor(), { userId: 2, label: 'Test' } as never)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when expiry is in the past', async () => {
      const { service } = makeService();
      const pastDate = new Date(Date.now() - 60_000).toISOString();

      await expect(service.createToken(makeActor(), { userId: 2, label: 'Test', expiresAt: pastDate } as never)).rejects.toThrow(BadRequestException);
    });

    it('creates token and emits audit event on success', async () => {
      const { service, magicLinkRepo, auditEvents } = makeService();

      const result = await service.createToken(makeActor(), { userId: 2, label: 'Demo' } as never);

      expect(magicLinkRepo.create).toHaveBeenCalledWith({ userId: 2, createdBy: 1, label: 'Demo', expiresAt: undefined });
      expect(result).toEqual({ id: 1, token: 'raw-token-hex', label: 'Demo', expiresAt: null });
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'magic_link.create' }));
    });
  });

  describe('loginWithToken', () => {
    const reply = {} as never;

    it('throws UnauthorizedException when token not found', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue(null);

      await expect(service.loginWithToken('bad-token', reply)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token is revoked', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue({ id: 1, userId: 2, revokedAt: new Date(), isActive: true, expiresAt: null });

      await expect(service.loginWithToken('token', reply)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token is deactivated', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue({ id: 1, userId: 2, revokedAt: null, isActive: false, expiresAt: null });

      await expect(service.loginWithToken('token', reply)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token is expired', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue({
        id: 1,
        userId: 2,
        revokedAt: null,
        isActive: true,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.loginWithToken('token', reply)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      const { service, magicLinkRepo, userService } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue({
        id: 1,
        userId: 2,
        revokedAt: null,
        isActive: true,
        expiresAt: null,
        label: 'Demo',
      });
      userService.findById.mockResolvedValue({ id: 2, active: false, username: 'demo' });

      await expect(service.loginWithToken('token', reply)).rejects.toThrow(UnauthorizedException);
    });

    it('updates usage, issues tokens, and emits audit on success', async () => {
      const { service, magicLinkRepo, authService, auditEvents, userService } = makeService();
      magicLinkRepo.findByTokenHash.mockResolvedValue({
        id: 5,
        userId: 2,
        revokedAt: null,
        isActive: true,
        expiresAt: null,
        label: 'Demo',
      });
      userService.findById.mockResolvedValue({ id: 2, active: true, username: 'demo' });

      const result = await service.loginWithToken('valid-token', reply, '10.0.0.1');

      expect(magicLinkRepo.updateUsage).toHaveBeenCalledWith(5);
      expect(authService.issueTokensForUser).toHaveBeenCalledWith(2, reply);
      expect(result).toEqual({ accessToken: 'jwt', user: {} });
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'magic_link.login' }));
    });
  });

  describe('listTokens', () => {
    it('delegates to repository', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findAll.mockResolvedValue([{ id: 1 }]);

      const result = await service.listTokens();
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('setActive', () => {
    it('throws ForbiddenException for non-superuser', async () => {
      const { service } = makeService();
      await expect(service.setActive(makeActor({ isSuperuser: false }), 1, false)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when token not found', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findById.mockResolvedValue(null);

      await expect(service.setActive(makeActor(), 1, false)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when token is already revoked', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findById.mockResolvedValue({ id: 1, revokedAt: new Date() });

      await expect(service.setActive(makeActor(), 1, false)).rejects.toThrow(BadRequestException);
    });

    it('deactivates token, revokes sessions, and emits audit', async () => {
      const { service, magicLinkRepo, authService, auditEvents } = makeService();
      magicLinkRepo.findById.mockResolvedValue({ id: 1, revokedAt: null });
      magicLinkRepo.setActive.mockResolvedValue({ id: 1, userId: 2, isActive: false });

      const result = await service.setActive(makeActor(), 1, false);

      expect(magicLinkRepo.setActive).toHaveBeenCalledWith(1, false);
      expect(authService.revokeAllUserSessions).toHaveBeenCalledWith(2);
      expect(result).toEqual({ id: 1, isActive: false });
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'magic_link.deactivate' }));
    });

    it('activates token without revoking sessions and emits audit', async () => {
      const { service, magicLinkRepo, authService, auditEvents } = makeService();
      magicLinkRepo.findById.mockResolvedValue({ id: 1, revokedAt: null });
      magicLinkRepo.setActive.mockResolvedValue({ id: 1, userId: 2, isActive: true });

      const result = await service.setActive(makeActor(), 1, true);

      expect(authService.revokeAllUserSessions).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 1, isActive: true });
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'magic_link.activate' }));
    });
  });

  describe('revokeToken', () => {
    it('throws ForbiddenException for non-superuser', async () => {
      const { service } = makeService();
      await expect(service.revokeToken(makeActor({ isSuperuser: false }), 1)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when token not found', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findById.mockResolvedValue(null);

      await expect(service.revokeToken(makeActor(), 1)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when token is already revoked', async () => {
      const { service, magicLinkRepo } = makeService();
      magicLinkRepo.findById.mockResolvedValue({ id: 1, revokedAt: new Date() });

      await expect(service.revokeToken(makeActor(), 1)).rejects.toThrow(BadRequestException);
    });

    it('revokes token, revokes sessions, and emits audit', async () => {
      const { service, magicLinkRepo, authService, auditEvents } = makeService();
      magicLinkRepo.findById.mockResolvedValue({ id: 1, revokedAt: null });
      magicLinkRepo.revoke.mockResolvedValue({ id: 1, userId: 2 });

      await service.revokeToken(makeActor(), 1);

      expect(magicLinkRepo.revoke).toHaveBeenCalledWith(1);
      expect(authService.revokeAllUserSessions).toHaveBeenCalledWith(2);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'magic_link.revoke' }));
    });
  });
});
