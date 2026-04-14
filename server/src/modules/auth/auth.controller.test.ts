import 'reflect-metadata';

import { AuthController } from './auth.controller';

function makeController() {
  const authService = {
    register: vi.fn(),
    setupStatus: vi.fn(),
    setup: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    buildUserResponse: vi.fn(),
    getSessions: vi.fn(),
    revokeSession: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
  };
  const oidcService = {
    generateState: vi.fn(),
    generateLinkState: vi.fn(),
    generatePreviewState: vi.fn(),
    handleCallback: vi.fn(),
    handleBackchannelLogout: vi.fn(),
    getLinkedIdentities: vi.fn(),
    unlinkIdentity: vi.fn(),
  };

  const controller = new AuthController(authService as never, oidcService as never);
  return { controller, authService, oidcService };
}

describe('AuthController', () => {
  it('delegates auth endpoint methods with request-derived inputs', async () => {
    const { controller, authService } = makeController();
    const reply = { setCookie: vi.fn() } as never;
    const req = { ip: '10.0.0.8', body: { logout_token: 'logout-1' } } as never;

    await controller.register({ username: 'jdoe' } as never);
    await controller.setupStatus();
    await controller.setup({ username: 'owner' } as never, 'setup-token', reply);
    await controller.login({ username: 'jdoe', password: 'pass' } as never, req, reply);
    await controller.refresh(req, reply);
    await controller.logout(req, reply);
    controller.me({ id: 1 } as never);
    await controller.getSessions({ id: 1 } as never);
    await controller.revokeSession({ id: 1 } as never, 5);
    await controller.forgotPassword({ email: 'jdoe@example.com' } as never, req);
    await controller.resetPassword({ token: 'reset-token', newPassword: 'N3wP@ssword' } as never, req);
    await controller.changePassword({ id: 1 } as never, { currentPassword: 'old', newPassword: 'new' } as never, req, reply);

    expect(authService.register).toHaveBeenCalledWith({ username: 'jdoe' });
    expect(authService.setupStatus).toHaveBeenCalled();
    expect(authService.setup).toHaveBeenCalledWith({ username: 'owner' }, 'setup-token', reply);
    expect(authService.login).toHaveBeenCalledWith({ username: 'jdoe', password: 'pass' }, reply, '10.0.0.8');
    expect(authService.refresh).toHaveBeenCalledWith(req, reply);
    expect(authService.logout).toHaveBeenCalledWith(req, reply);
    expect(authService.buildUserResponse).toHaveBeenCalledWith({ id: 1 });
    expect(authService.getSessions).toHaveBeenCalledWith(1);
    expect(authService.revokeSession).toHaveBeenCalledWith(1, 5);
    expect(authService.forgotPassword).toHaveBeenCalledWith({ email: 'jdoe@example.com' }, '10.0.0.8');
    expect(authService.resetPassword).toHaveBeenCalledWith({ token: 'reset-token', newPassword: 'N3wP@ssword' }, '10.0.0.8');
    expect(authService.changePassword).toHaveBeenCalledWith(1, { currentPassword: 'old', newPassword: 'new' }, reply, '10.0.0.8');
  });

  it('delegates oidc endpoints to OidcService', async () => {
    const { controller, oidcService } = makeController();
    const reply = {} as never;
    const stateResult = { state: 'state-123', authorizationEndpoint: 'https://idp.example.com/auth' };
    oidcService.generateState.mockResolvedValue(stateResult);
    oidcService.generateLinkState.mockResolvedValue(stateResult);
    oidcService.generatePreviewState.mockResolvedValue(stateResult);
    oidcService.getLinkedIdentities.mockResolvedValue([]);

    await expect(controller.oidcGenerateState('keycloak')).resolves.toEqual(stateResult);
    await controller.oidcCallback({ code: 'abc' } as never, reply);
    await controller.oidcBackchannelLogout({ body: { logout_token: 'logout-1' } } as never);
    await controller.oidcBackchannelLogout({ body: undefined } as never);
    await controller.oidcGenerateLinkState({ id: 7 } as never, 'keycloak');
    await controller.oidcGeneratePreviewState('keycloak');
    await controller.oidcGetIdentities({ id: 7 } as never);
    await controller.oidcUnlinkIdentity({ id: 7 } as never, 3, { password: 'Secret1!' });

    expect(oidcService.generateState).toHaveBeenCalledWith('keycloak');
    expect(oidcService.handleCallback).toHaveBeenCalledWith({ code: 'abc' }, reply);
    expect(oidcService.handleBackchannelLogout).toHaveBeenNthCalledWith(1, 'logout-1');
    expect(oidcService.handleBackchannelLogout).toHaveBeenNthCalledWith(2, '');
    expect(oidcService.generateLinkState).toHaveBeenCalledWith(7, 'keycloak');
    expect(oidcService.generatePreviewState).toHaveBeenCalledWith('keycloak');
    expect(oidcService.getLinkedIdentities).toHaveBeenCalledWith(7);
    expect(oidcService.unlinkIdentity).toHaveBeenCalledWith(7, 3, 'Secret1!');
  });

  it('defines throttling metadata for sensitive public endpoints', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';

    const registerLimit = Reflect.getMetadata(limitKey, AuthController.prototype.register) as number;
    const registerTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.register) as number;
    const setupLimit = Reflect.getMetadata(limitKey, AuthController.prototype.setup) as number;
    const setupTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.setup) as number;
    const loginLimit = Reflect.getMetadata(limitKey, AuthController.prototype.login) as number;
    const loginTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.login) as number;
    const forgotLimit = Reflect.getMetadata(limitKey, AuthController.prototype.forgotPassword) as number;
    const forgotTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.forgotPassword) as number;
    const resetLimit = Reflect.getMetadata(limitKey, AuthController.prototype.resetPassword) as number;
    const resetTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.resetPassword) as number;

    expect(registerLimit).toBe(3);
    expect(registerTtl).toBe(60_000);
    expect(setupLimit).toBe(3);
    expect(setupTtl).toBe(60_000);
    expect(loginLimit).toBe(5);
    expect(loginTtl).toBe(60_000);
    expect(forgotLimit).toBe(3);
    expect(forgotTtl).toBe(3_600_000);
    expect(resetLimit).toBe(5);
    expect(resetTtl).toBe(60_000);

    const oidcStateLimit = Reflect.getMetadata(limitKey, AuthController.prototype.oidcGenerateState) as number;
    const oidcStateTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.oidcGenerateState) as number;
    const oidcCallbackLimit = Reflect.getMetadata(limitKey, AuthController.prototype.oidcCallback) as number;
    const oidcCallbackTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.oidcCallback) as number;

    expect(oidcStateLimit).toBe(10);
    expect(oidcStateTtl).toBe(60_000);
    expect(oidcCallbackLimit).toBe(5);
    expect(oidcCallbackTtl).toBe(60_000);
  });
});
