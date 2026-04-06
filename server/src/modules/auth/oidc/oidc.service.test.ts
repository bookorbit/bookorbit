import { UnauthorizedException } from '@nestjs/common';

import { OidcService } from './oidc.service';

function makeService() {
  const appSettings = {
    getOidcConfig: vi.fn().mockResolvedValue({
      enabled: true,
      issuerUri: 'https://issuer.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
      autoProvision: { enabled: false, allowLocalLinking: false, defaultPermissionNames: [] },
    }),
  };
  const discovery = {
    getDiscoveryDoc: vi.fn().mockResolvedValue({
      issuer: 'https://issuer.example',
      authorizationEndpoint: 'https://issuer.example/auth',
      tokenEndpoint: 'https://issuer.example/token',
      jwksUri: 'https://issuer.example/jwks',
    }),
  };
  const tokenClient = {
    exchangeCode: vi.fn().mockResolvedValue({ idToken: 'id-token', accessToken: 'access-token' }),
    fetchUserInfo: vi.fn().mockResolvedValue({}),
  };
  const tokenValidator = {
    validateIdToken: vi.fn().mockResolvedValue({ sub: 'sub-1' }),
  };
  const claimExtractor = {
    extract: vi.fn(),
  };
  const stateService = {
    generate: vi.fn(),
    validateAndConsume: vi.fn().mockReturnValue(true),
  };
  const sessionRepo = {
    create: vi.fn().mockResolvedValue(undefined),
  };
  const groupMapping = {
    syncUserGroups: vi.fn().mockResolvedValue(undefined),
  };
  const backchannelLogout = {
    handleLogout: vi.fn().mockResolvedValue(undefined),
  };
  const userService = {
    findByOidcSubject: vi.fn(),
    findByUsername: vi.fn(),
    linkOidcIdentity: vi.fn(),
    createOidcUser: vi.fn(),
    setPermissionsDirectly: vi.fn(),
  };
  const authService = {
    getRefreshTokenExpiryDate: vi.fn().mockReturnValue(new Date('2026-01-08T00:00:00Z')),
    issueTokensForUser: vi.fn(),
  };

  const service = new OidcService(
    appSettings as never,
    discovery as never,
    tokenClient as never,
    tokenValidator as never,
    claimExtractor as never,
    stateService as never,
    sessionRepo as never,
    groupMapping as never,
    backchannelLogout as never,
    userService as never,
    authService as never,
  );

  return { service, claimExtractor, userService, appSettings, authService, sessionRepo };
}

describe('OidcService', () => {
  it('rejects callback when extracted subject is missing', async () => {
    const { service, claimExtractor } = makeService();
    claimExtractor.extract.mockReturnValue({
      subject: '',
      username: 'u1',
      name: 'User One',
      email: 'u1@example.com',
      groups: [],
    });

    await expect(
      service.handleCallback(
        {
          code: 'code',
          codeVerifier: 'verifier',
          redirectUri: 'https://app.example/callback',
          nonce: 'nonce',
          state: 'state',
        },
        { setCookie: vi.fn() } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('reuses an OIDC user when auto-provision races on the new unique constraint', async () => {
    const { service, claimExtractor, userService, appSettings, authService, sessionRepo } = makeService();
    const existingUser = { id: 7, active: true };
    appSettings.getOidcConfig.mockResolvedValue({
      enabled: true,
      issuerUri: 'https://issuer.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
      autoProvision: { enabled: true, allowLocalLinking: false, defaultPermissionNames: ['library_download'] },
    });
    claimExtractor.extract.mockReturnValue({
      subject: 'sub-1',
      username: 'u1',
      name: 'User One',
      email: 'u1@example.com',
      groups: [],
    });
    userService.findByOidcSubject.mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser);
    userService.createOidcUser.mockRejectedValueOnce({ code: '23505' });
    authService.issueTokensForUser.mockResolvedValue({ accessToken: 'token' });

    await expect(
      service.handleCallback(
        {
          code: 'code',
          codeVerifier: 'verifier',
          redirectUri: 'https://app.example/callback',
          nonce: 'nonce',
          state: 'state',
        },
        { setCookie: vi.fn() } as never,
      ),
    ).resolves.toEqual({ accessToken: 'token' });

    expect(userService.setPermissionsDirectly).not.toHaveBeenCalled();
    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        oidcSubject: 'sub-1',
        oidcIssuer: 'https://issuer.example',
        expiresAt: new Date('2026-01-08T00:00:00Z'),
      }),
    );
  });
});
