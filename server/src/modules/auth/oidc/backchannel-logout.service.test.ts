vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn().mockReturnValue('mocked-jwks'),
  jwtVerify: vi.fn(),
}));

import { BackchannelLogoutService } from './backchannel-logout.service';

const DISCOVERY_DOC = {
  issuer: 'https://idp.example.com',
  jwksUri: 'https://idp.example.com/jwks',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  backchannelLogoutSupported: true,
};

const PROVIDER = {
  id: 1,
  slug: 'keycloak',
  enabled: true,
  issuerUri: 'https://idp.example.com',
  clientId: 'client-id',
  clientSecret: 'secret',
};

function makeLogoutToken(payload: Record<string, unknown> = {}): string {
  const defaultPayload = { iss: 'https://idp.example.com', sub: 'u1', ...payload };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(defaultPayload)).toString('base64url');
  return `${header}.${body}.fake-sig`;
}

function makeDb() {
  return {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ jti: 'jti-1' }]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeService(dbOverrides?: Partial<ReturnType<typeof makeDb>>) {
  const db = { ...makeDb(), ...dbOverrides };
  const providerService = {
    findByIssuerUri: vi.fn().mockResolvedValue(PROVIDER),
  };
  const discovery = {
    getDiscoveryDoc: vi.fn().mockResolvedValue(DISCOVERY_DOC),
  };
  const tokenValidator = {
    validateLogoutToken: vi.fn(),
  };
  const sessionRepo = {
    findActiveBySid: vi.fn(),
    revokeBySid: vi.fn().mockResolvedValue(undefined),
    findActiveBySubjectAndIssuer: vi.fn(),
    revokeBySubjectAndIssuer: vi.fn().mockResolvedValue(undefined),
  };
  const userService = {
    incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  };

  const service = new BackchannelLogoutService(
    db as never,
    providerService as never,
    discovery as never,
    tokenValidator as never,
    sessionRepo as never,
    userService as never,
  );

  return { service, db, providerService, discovery, tokenValidator, sessionRepo, userService };
}

describe('BackchannelLogoutService', () => {
  it('does nothing when no matching provider found', async () => {
    const { service, providerService, tokenValidator } = makeService();
    providerService.findByIssuerUri.mockResolvedValue(null);

    await service.handleLogout(makeLogoutToken());
    expect(tokenValidator.validateLogoutToken).not.toHaveBeenCalled();
  });

  it('does nothing when provider is disabled', async () => {
    const { service, providerService, tokenValidator } = makeService();
    providerService.findByIssuerUri.mockResolvedValue({ ...PROVIDER, enabled: false });

    await service.handleLogout(makeLogoutToken());
    expect(tokenValidator.validateLogoutToken).not.toHaveBeenCalled();
  });

  it('revokes sessions by sid when sid is present in claims', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', sid: 'sess-1', jti: 'jti-1' });
    sessionRepo.findActiveBySid.mockResolvedValue({ userId: 42 });

    await service.handleLogout(makeLogoutToken({ sub: 'u1' }));

    expect(sessionRepo.revokeBySid).toHaveBeenCalledWith('sess-1');
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(42);
  });

  it('falls back to subject lookup when sid session not found', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', sid: 'sess-missing', jti: 'jti-2' });
    sessionRepo.findActiveBySid.mockResolvedValue(null);
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 99 }]);

    await service.handleLogout(makeLogoutToken({ sub: 'u1' }));

    expect(sessionRepo.revokeBySubjectAndIssuer).toHaveBeenCalledWith('u1', 'https://idp.example.com');
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(99);
  });

  it('falls back to subject lookup when no sid in claims', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', jti: 'jti-3' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 55 }]);

    await service.handleLogout(makeLogoutToken({ sub: 'u1' }));

    expect(sessionRepo.findActiveBySid).not.toHaveBeenCalled();
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(55);
  });

  it('does nothing when no active session is found for sub or sid', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'ghost-user', jti: 'jti-4' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([]);

    await service.handleLogout(makeLogoutToken({ sub: 'ghost-user' }));

    expect(userService.incrementTokenVersion).not.toHaveBeenCalled();
  });

  it('proceeds normally when jti is absent', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 7 }]);

    await service.handleLogout(makeLogoutToken({ sub: 'u1' }));
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(7);
  });

  describe('JTI replay prevention (DB-backed)', () => {
    it('rejects second call when DB insert returns empty (conflict = already used)', async () => {
      const jtiInsertResult: { jti: string }[] = [];
      const db = makeDb();
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(jtiInsertResult),
          }),
        }),
      });

      const { service, tokenValidator, sessionRepo, userService } = makeService(db);
      tokenValidator.validateLogoutToken.mockResolvedValue({
        sub: 'u1',
        jti: 'replay-jti',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 10 }]);

      await service.handleLogout(makeLogoutToken({ sub: 'u1', jti: 'replay-jti' }));

      expect(userService.incrementTokenVersion).not.toHaveBeenCalled();
    });

    it('processes successfully when DB insert returns the new row (first use)', async () => {
      const { service, tokenValidator, sessionRepo, userService } = makeService();
      tokenValidator.validateLogoutToken.mockResolvedValue({
        sub: 'u1',
        jti: 'fresh-jti',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 10 }]);

      await service.handleLogout(makeLogoutToken({ sub: 'u1', jti: 'fresh-jti' }));

      expect(userService.incrementTokenVersion).toHaveBeenCalledWith(10);
    });

    it('stores JTI with expiry derived from exp claim', async () => {
      const valuesMock = vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ jti: 'jti-exp' }]),
        }),
      });
      const db = makeDb();
      db.insert.mockReturnValue({ values: valuesMock });

      const { service, tokenValidator, sessionRepo } = makeService(db);
      const exp = Math.floor(Date.now() / 1000) + 7200;
      tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', jti: 'jti-exp', exp });
      sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 5 }]);

      await service.handleLogout(makeLogoutToken({ sub: 'u1', jti: 'jti-exp', exp }));

      const [[{ jti, expiresAt }]] = valuesMock.mock.calls;
      expect(jti).toBe('jti-exp');
      expect(expiresAt.getTime()).toBeCloseTo(exp * 1000, -3);
    });

    it('prunes expired JTIs from DB after each logout', async () => {
      const { service, tokenValidator, sessionRepo, db } = makeService();
      tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', jti: 'prune-jti' });
      sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 3 }]);

      await service.handleLogout(makeLogoutToken({ sub: 'u1', jti: 'prune-jti' }));

      expect(db.delete).toHaveBeenCalled();
    });
  });
});
