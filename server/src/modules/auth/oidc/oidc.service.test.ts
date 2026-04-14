import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { OidcService } from './oidc.service';

const APP_URL = 'http://localhost:5173';
const VALID_REDIRECT_URI = `${APP_URL}/oauth2-callback`;

const PROVIDER = {
  id: 1,
  slug: 'keycloak',
  displayName: 'Keycloak',
  enabled: true,
  issuerUri: 'https://issuer.example',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scopes: 'openid profile email',
  iconUrl: null,
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: false, defaultPermissionNames: [] },
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const providerService = {
    findBySlugOrFail: vi.fn().mockResolvedValue(PROVIDER),
    findByIdOrFail: vi.fn().mockResolvedValue(PROVIDER),
    findByIssuerUri: vi.fn().mockResolvedValue(PROVIDER),
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
    extract: vi.fn().mockReturnValue({ subject: 'sub-1', username: 'u1', name: 'User One', email: 'u1@example.com', groups: [] }),
  };
  const stateService = {
    generate: vi.fn().mockResolvedValue('state-token'),
    validateAndConsume: vi.fn().mockResolvedValue({ valid: true, providerId: 1 }),
  };
  const sessionRepo = {
    create: vi.fn().mockResolvedValue(undefined),
  };
  const groupMapping = {
    syncUserGroups: vi.fn().mockResolvedValue(undefined),
    removeProviderGrants: vi.fn().mockResolvedValue(undefined),
  };
  const backchannelLogout = {
    handleLogout: vi.fn().mockResolvedValue(undefined),
  };
  const identityRepo = {
    findByProviderAndSubject: vi.fn().mockResolvedValue(null),
    findByIssuerAndSubject: vi.fn().mockResolvedValue(null),
    findByUser: vi.fn().mockResolvedValue([]),
    findByUserAndProvider: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    remove: vi.fn().mockResolvedValue({ id: 1 }),
    countByUser: vi.fn().mockResolvedValue(1),
  };
  const userService = {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    linkOidcIdentity: vi.fn(),
    findPasswordHashById: vi.fn(),
    createOidcUser: vi.fn(),
    setPermissionsDirectly: vi.fn(),
  };
  const authService = {
    getRefreshTokenExpiryDate: vi.fn().mockReturnValue(new Date('2026-01-08T00:00:00Z')),
    issueTokensForUser: vi.fn().mockResolvedValue({ accessToken: 'token', user: {} }),
  };
  const auditEvents = {
    emit: vi.fn(),
  };
  const configService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'app.appUrl') return APP_URL;
      return undefined;
    }),
  };

  const service = new OidcService(
    providerService as never,
    discovery as never,
    tokenClient as never,
    tokenValidator as never,
    claimExtractor as never,
    stateService as never,
    sessionRepo as never,
    groupMapping as never,
    backchannelLogout as never,
    identityRepo as never,
    userService as never,
    authService as never,
    auditEvents as never,
    configService as never,
  );

  return {
    service,
    providerService,
    claimExtractor,
    userService,
    authService,
    sessionRepo,
    stateService,
    auditEvents,
    discovery,
    tokenValidator,
    identityRepo,
    groupMapping,
  };
}

const BASE_CALLBACK = {
  code: 'code',
  codeVerifier: 'verifier',
  redirectUri: VALID_REDIRECT_URI,
  nonce: 'nonce',
  state: 'state',
};

describe('OidcService', () => {
  describe('generateState', () => {
    it('throws when provider is disabled', async () => {
      const { service, providerService } = makeService();
      providerService.findBySlugOrFail.mockResolvedValue({ ...PROVIDER, enabled: false });
      await expect(service.generateState('keycloak')).rejects.toThrow(UnauthorizedException);
    });

    it('returns state and authorizationEndpoint', async () => {
      const { service } = makeService();
      const result = await service.generateState('keycloak');
      expect(result).toMatchObject({ state: 'state-token', authorizationEndpoint: 'https://issuer.example/auth' });
    });
  });

  describe('generateLinkState', () => {
    it('generates state with link mode meta', async () => {
      const { service, stateService } = makeService();
      stateService.generate.mockResolvedValue('link-state');
      const result = await service.generateLinkState(42, 'keycloak');
      expect(stateService.generate).toHaveBeenCalledWith(1, { mode: 'link', userId: 42 });
      expect(result.state).toBe('link-state');
    });

    it('throws when already linked to provider', async () => {
      const { service, identityRepo } = makeService();
      identityRepo.findByUserAndProvider.mockResolvedValue({ id: 1 });
      await expect(service.generateLinkState(42, 'keycloak')).rejects.toThrow(BadRequestException);
    });
  });

  describe('generatePreviewState', () => {
    it('generates state with preview mode meta', async () => {
      const { service, stateService } = makeService();
      stateService.generate.mockResolvedValue('preview-state');
      const result = await service.generatePreviewState('keycloak');
      expect(stateService.generate).toHaveBeenCalledWith(1, { mode: 'preview' });
      expect(result.state).toBe('preview-state');
    });
  });

  describe('handleCallback', () => {
    it('rejects callback when state is invalid', async () => {
      const { service, stateService } = makeService();
      stateService.validateAndConsume.mockResolvedValue({ valid: false });
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects callback when redirectUri does not match allowed app URL', async () => {
      const { service } = makeService();
      await expect(service.handleCallback({ ...BASE_CALLBACK, redirectUri: 'https://evil.example/callback' }, {} as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects callback when extracted subject is missing', async () => {
      const { service, claimExtractor } = makeService();
      claimExtractor.extract.mockReturnValue({ subject: '', username: 'u1', name: 'User One', email: 'u1@example.com', groups: [] });
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });

    it('returns login mode response for existing identity', async () => {
      const { service, identityRepo, userService, authService } = makeService();
      const user = { id: 5, username: 'u1', active: true, permissions: [] };
      identityRepo.findByProviderAndSubject.mockResolvedValue({ userId: 5 });
      userService.findById.mockResolvedValue(user);
      authService.issueTokensForUser.mockResolvedValue({ accessToken: 'at', user: { id: 5 } });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'login', accessToken: 'at' });
    });

    it('returns preview mode response with raw+mapped claims', async () => {
      const { service, stateService, claimExtractor, tokenValidator } = makeService();
      stateService.validateAndConsume.mockResolvedValue({ valid: true, providerId: 1, meta: { mode: 'preview' } });
      tokenValidator.validateIdToken.mockResolvedValue({ sub: 'sub-1', email: 'u1@example.com' });
      claimExtractor.extract.mockReturnValue({ subject: 'sub-1', username: 'u1', name: 'User One', email: 'u1@example.com', groups: ['g1'] });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'preview', claims: { mapped: { username: 'u1', email: 'u1@example.com' } } });
    });

    it('returns link mode response and creates identity', async () => {
      const { service, stateService, identityRepo, auditEvents } = makeService();
      stateService.validateAndConsume.mockResolvedValue({ valid: true, providerId: 1, meta: { mode: 'link', userId: 42 } });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'link', linked: true });
      expect(identityRepo.create).toHaveBeenCalled();
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.identity_linked' }));
    });

    it('rejects inactive user', async () => {
      const { service, identityRepo, userService } = makeService();
      identityRepo.findByProviderAndSubject.mockResolvedValue({ userId: 5 });
      userService.findById.mockResolvedValue({ id: 5, username: 'u1', active: false, permissions: [] });
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getLinkedIdentities', () => {
    it('delegates to identityRepo.findByUser', async () => {
      const { service, identityRepo } = makeService();
      const identities = [{ id: 1, providerId: 1, oidcSubject: 'sub-1' }];
      identityRepo.findByUser.mockResolvedValue(identities);
      const result = await service.getLinkedIdentities(5);
      expect(identityRepo.findByUser).toHaveBeenCalledWith(5);
      expect(result).toEqual(identities);
    });
  });

  describe('unlinkIdentity', () => {
    it('throws BadRequestException when password is incorrect', async () => {
      const { service, userService } = makeService();
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('correct-password', 4);
      userService.findPasswordHashById.mockResolvedValue(hash);

      await expect(service.unlinkIdentity(5, 1, 'wrong-password')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user not found', async () => {
      const { service, userService } = makeService();
      userService.findPasswordHashById.mockResolvedValue(null);

      await expect(service.unlinkIdentity(99, 1, 'any-password')).rejects.toThrow(BadRequestException);
    });

    it('unlinks identity on correct password and emits OidcIdentityUnlinked', async () => {
      const { service, userService, identityRepo, auditEvents } = makeService();
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('correct-password', 4);
      userService.findPasswordHashById.mockResolvedValue(hash);
      userService.findById.mockResolvedValue({ id: 5, provisioningMethod: 'local' });
      identityRepo.findByUserAndProvider.mockResolvedValue({ id: 1, oidcSubject: 'sub-1', oidcIssuer: 'https://issuer.example' });

      await service.unlinkIdentity(5, 1, 'correct-password');
      expect(identityRepo.remove).toHaveBeenCalledWith(5, 1);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.identity_unlinked' }));
    });
  });
});
