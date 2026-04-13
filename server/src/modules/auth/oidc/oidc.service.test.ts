import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { OidcService } from './oidc.service';

const APP_URL = 'http://localhost:5173';
const VALID_REDIRECT_URI = `${APP_URL}/oauth2-callback`;

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
    extract: vi.fn().mockReturnValue({ subject: 'sub-1', username: 'u1', name: 'User One', email: 'u1@example.com', groups: [] }),
  };
  const stateService = {
    generate: vi.fn().mockResolvedValue('state-token'),
    validateAndConsume: vi.fn().mockResolvedValue({ valid: true }),
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
    unlinkOidcIdentity: vi.fn(),
    getUserOidcIdentity: vi.fn(),
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
    auditEvents as never,
    configService as never,
  );

  return { service, claimExtractor, userService, appSettings, authService, sessionRepo, stateService, auditEvents, discovery, tokenValidator };
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
    it('throws when OIDC is disabled', async () => {
      const { service, appSettings } = makeService();
      appSettings.getOidcConfig.mockResolvedValue({ enabled: false });
      await expect(service.generateState()).rejects.toThrow(UnauthorizedException);
    });

    it('returns state and authorizationEndpoint', async () => {
      const { service } = makeService();
      const result = await service.generateState();
      expect(result).toMatchObject({ state: 'state-token', authorizationEndpoint: 'https://issuer.example/auth' });
    });
  });

  describe('generateLinkState', () => {
    it('generates state with link mode meta', async () => {
      const { service, stateService } = makeService();
      stateService.generate.mockResolvedValue('link-state');
      const result = await service.generateLinkState(42);
      expect(stateService.generate).toHaveBeenCalledWith({ mode: 'link', userId: 42 });
      expect(result.state).toBe('link-state');
    });
  });

  describe('generatePreviewState', () => {
    it('generates state with preview mode meta', async () => {
      const { service, stateService } = makeService();
      stateService.generate.mockResolvedValue('preview-state');
      const result = await service.generatePreviewState();
      expect(stateService.generate).toHaveBeenCalledWith({ mode: 'preview' });
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

    it('returns login mode response for existing OIDC user', async () => {
      const { service, userService, authService } = makeService();
      const user = { id: 5, username: 'u1', active: true };
      userService.findByOidcSubject.mockResolvedValue(user);
      authService.issueTokensForUser.mockResolvedValue({ accessToken: 'at', user: { id: 5 } });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'login', accessToken: 'at' });
    });

    it('emits OidcLogin audit event on successful login', async () => {
      const { service, userService, auditEvents } = makeService();
      userService.findByOidcSubject.mockResolvedValue({ id: 5, username: 'u1', active: true });

      await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.login' }));
    });

    it('returns preview mode response with raw+mapped claims', async () => {
      const { service, stateService, claimExtractor, tokenValidator } = makeService();
      stateService.validateAndConsume.mockResolvedValue({ valid: true, meta: { mode: 'preview' } });
      tokenValidator.validateIdToken.mockResolvedValue({ sub: 'sub-1', email: 'u1@example.com' });
      claimExtractor.extract.mockReturnValue({ subject: 'sub-1', username: 'u1', name: 'User One', email: 'u1@example.com', groups: ['g1'] });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'preview', claims: { mapped: { username: 'u1', email: 'u1@example.com' } } });
    });

    it('returns link mode response and emits OidcIdentityLinked', async () => {
      const { service, stateService, userService, auditEvents } = makeService();
      stateService.validateAndConsume.mockResolvedValue({ valid: true, meta: { mode: 'link', userId: 42 } });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'link', linked: true });
      expect(userService.linkOidcIdentity).toHaveBeenCalledWith(42, 'sub-1', 'https://issuer.example', undefined);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.identity_linked' }));
    });

    it('rejects inactive user', async () => {
      const { service, userService } = makeService();
      userService.findByOidcSubject.mockResolvedValue({ id: 5, username: 'u1', active: false });
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });

    it('throws when OIDC is disabled', async () => {
      const { service, appSettings } = makeService();
      appSettings.getOidcConfig.mockResolvedValue({ enabled: false });
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });

    it('auto-provisions a new user and emits OidcUserProvisioned', async () => {
      const { service, userService, appSettings, auditEvents } = makeService();
      const newUser = { id: 9, username: 'u1', active: true };
      appSettings.getOidcConfig.mockResolvedValue({
        enabled: true,
        issuerUri: 'https://issuer.example',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
        autoProvision: { enabled: true, allowLocalLinking: false, defaultPermissionNames: [] },
      });
      userService.findByOidcSubject.mockResolvedValue(null);
      userService.createOidcUser.mockResolvedValue(newUser);

      await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.user_provisioned' }));
    });

    it('reuses an OIDC user when auto-provision races on unique constraint', async () => {
      const { service, claimExtractor, userService, appSettings, authService, sessionRepo } = makeService();
      const existingUser = { id: 7, username: 'u1', active: true };
      appSettings.getOidcConfig.mockResolvedValue({
        enabled: true,
        issuerUri: 'https://issuer.example',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
        autoProvision: { enabled: true, allowLocalLinking: false, defaultPermissionNames: ['library_download'] },
      });
      claimExtractor.extract.mockReturnValue({ subject: 'sub-1', username: 'u1', name: 'User One', email: 'u1@example.com', groups: [] });
      userService.findByOidcSubject.mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser);
      userService.createOidcUser.mockRejectedValueOnce({ code: '23505' });
      authService.issueTokensForUser.mockResolvedValue({ accessToken: 'token', user: {} });

      const result = await service.handleCallback(BASE_CALLBACK, {} as never);
      expect(result).toMatchObject({ mode: 'login', accessToken: 'token' });
      expect(userService.setPermissionsDirectly).not.toHaveBeenCalled();
      expect(sessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, oidcSubject: 'sub-1' }));
    });

    it('throws USER_NOT_PROVISIONED when no user and auto-provision is off', async () => {
      const { service, userService } = makeService();
      userService.findByOidcSubject.mockResolvedValue(null);
      await expect(service.handleCallback(BASE_CALLBACK, {} as never)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getLinkedIdentity', () => {
    it('delegates to userService.getUserOidcIdentity', async () => {
      const { service, userService } = makeService();
      userService.getUserOidcIdentity.mockResolvedValue({ oidcSubject: 'sub-1', oidcIssuer: 'https://issuer.example' });
      const result = await service.getLinkedIdentity(5);
      expect(userService.getUserOidcIdentity).toHaveBeenCalledWith(5);
      expect(result).toEqual({ oidcSubject: 'sub-1', oidcIssuer: 'https://issuer.example' });
    });
  });

  describe('unlinkIdentity', () => {
    it('throws BadRequestException when password is incorrect', async () => {
      const { service, userService } = makeService();
      // Hash of 'correct-password' would be stored; we supply a bcrypt hash of something else
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('correct-password', 4);
      userService.findPasswordHashById.mockResolvedValue(hash);

      await expect(service.unlinkIdentity(5, 'wrong-password')).rejects.toThrow(BadRequestException);
      expect(userService.unlinkOidcIdentity).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user not found', async () => {
      const { service, userService } = makeService();
      userService.findPasswordHashById.mockResolvedValue(null);

      await expect(service.unlinkIdentity(99, 'any-password')).rejects.toThrow(BadRequestException);
    });

    it('unlinks identity on correct password and emits OidcIdentityUnlinked', async () => {
      const { service, userService, auditEvents } = makeService();
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('correct-password', 4);
      userService.findPasswordHashById.mockResolvedValue(hash);
      userService.getUserOidcIdentity.mockResolvedValue({ oidcSubject: 'sub-1', oidcIssuer: 'https://issuer.example' });

      await service.unlinkIdentity(5, 'correct-password');
      expect(userService.unlinkOidcIdentity).toHaveBeenCalledWith(5);
      expect(auditEvents.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'auth.oidc.identity_unlinked' }));
    });
  });
});
