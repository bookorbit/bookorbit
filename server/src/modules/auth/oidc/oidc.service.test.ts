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

  return { service, claimExtractor };
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
});
