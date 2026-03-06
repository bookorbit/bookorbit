jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue('mocked-jwks'),
  jwtVerify: jest.fn(),
}));

import { BackchannelLogoutService } from './backchannel-logout.service';

const DISCOVERY_DOC = {
  issuer: 'https://idp.example.com',
  jwksUri: 'https://idp.example.com/jwks',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  backchannelLogoutSupported: true,
};

function makeService() {
  const db = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getOidcConfig: jest.fn().mockResolvedValue({ enabled: true, issuerUri: 'https://idp.example.com', clientId: 'client-id' }),
  };
  const discovery = {
    getDiscoveryDoc: jest.fn().mockResolvedValue(DISCOVERY_DOC),
  };
  const tokenValidator = {
    validateLogoutToken: jest.fn(),
  };
  const sessionRepo = {
    findActiveBySid: jest.fn(),
    revokeBySid: jest.fn().mockResolvedValue(undefined),
    findActiveBySubjectAndIssuer: jest.fn(),
    revokeBySubjectAndIssuer: jest.fn().mockResolvedValue(undefined),
  };
  const userService = {
    incrementTokenVersion: jest.fn().mockResolvedValue(undefined),
  };

  const service = new BackchannelLogoutService(
    db as never,
    appSettings as never,
    discovery as never,
    tokenValidator as never,
    sessionRepo as never,
    userService as never,
  );

  return { service, db, appSettings, discovery, tokenValidator, sessionRepo, userService };
}

describe('BackchannelLogoutService', () => {
  it('does nothing when OIDC is disabled', async () => {
    const { service, appSettings, tokenValidator } = makeService();
    appSettings.getOidcConfig.mockResolvedValue({ enabled: false });

    await service.handleLogout('logout-token');
    expect(tokenValidator.validateLogoutToken).not.toHaveBeenCalled();
  });

  it('revokes sessions by sid when sid is present in claims', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', sid: 'sess-1', jti: 'jti-1' });
    sessionRepo.findActiveBySid.mockResolvedValue({ userId: 42 });

    await service.handleLogout('logout-token');

    expect(sessionRepo.revokeBySid).toHaveBeenCalledWith('sess-1');
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(42);
  });

  it('falls back to subject lookup when sid session not found', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', sid: 'sess-missing', jti: 'jti-2' });
    sessionRepo.findActiveBySid.mockResolvedValue(null);
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 99 }]);

    await service.handleLogout('logout-token');

    expect(sessionRepo.revokeBySubjectAndIssuer).toHaveBeenCalledWith('u1', 'https://idp.example.com');
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(99);
  });

  it('falls back to subject lookup when no sid in claims', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', jti: 'jti-3' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 55 }]);

    await service.handleLogout('logout-token');

    expect(sessionRepo.findActiveBySid).not.toHaveBeenCalled();
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(55);
  });

  it('does nothing when no active session is found for sub or sid', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'ghost-user', jti: 'jti-4' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([]);

    await service.handleLogout('logout-token');

    expect(userService.incrementTokenVersion).not.toHaveBeenCalled();
  });

  it('prevents JTI replay — ignores second call with same jti', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1', jti: 'replay-jti', exp: Math.floor(Date.now() / 1000) + 3600 });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 10 }]);

    await service.handleLogout('token-1');
    await service.handleLogout('token-2');

    // incrementTokenVersion should only be called once (second call is a replay)
    expect(userService.incrementTokenVersion).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when jti is absent', async () => {
    const { service, tokenValidator, sessionRepo, userService } = makeService();
    tokenValidator.validateLogoutToken.mockResolvedValue({ sub: 'u1' });
    sessionRepo.findActiveBySubjectAndIssuer.mockResolvedValue([{ userId: 7 }]);

    await service.handleLogout('token-no-jti');
    expect(userService.incrementTokenVersion).toHaveBeenCalledWith(7);
  });
});
