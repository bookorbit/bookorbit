import 'reflect-metadata';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
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

  const magicLinkService = {
    createToken: vi.fn(),
    loginWithToken: vi.fn(),
    listTokens: vi.fn(),
    revokeToken: vi.fn(),
    setActive: vi.fn(),
  };

  const controller = new AuthController(authService as never, oidcService as never, magicLinkService as never);
  return { controller, authService, oidcService, magicLinkService };
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

  it('delegates magic link endpoints to MagicLinkService', async () => {
    const { controller, magicLinkService } = makeController();
    const user = { id: 1, isSuperuser: true, username: 'admin' } as never;
    const reply = { setCookie: vi.fn() } as never;
    const req = { ip: '10.0.0.1' } as never;

    magicLinkService.createToken.mockResolvedValue({ id: 1, token: 'raw', label: 'Demo', expiresAt: null });
    magicLinkService.listTokens.mockResolvedValue([]);
    magicLinkService.setActive.mockResolvedValue({ id: 1, isActive: false });
    magicLinkService.revokeToken.mockResolvedValue(undefined);
    magicLinkService.loginWithToken.mockResolvedValue({ accessToken: 'jwt' });

    await controller.createMagicLink(user, { userId: 2, label: 'Demo' } as never);
    await controller.listMagicLinks(user);
    await controller.updateMagicLink(user, 1, { isActive: false } as never);
    await controller.revokeMagicLink(user, 1);
    await controller.loginWithMagicLink({ token: 'raw-token' } as never, reply, req);

    expect(magicLinkService.createToken).toHaveBeenCalledWith(user, { userId: 2, label: 'Demo' });
    expect(magicLinkService.listTokens).toHaveBeenCalled();
    expect(magicLinkService.setActive).toHaveBeenCalledWith(user, 1, false);
    expect(magicLinkService.revokeToken).toHaveBeenCalledWith(user, 1);
    expect(magicLinkService.loginWithToken).toHaveBeenCalledWith('raw-token', reply, '10.0.0.1');
  });

  it('throws ForbiddenException from listMagicLinks for non-superuser', () => {
    const { controller } = makeController();
    const user = { id: 2, isSuperuser: false, username: 'viewer' } as never;

    expect(() => controller.listMagicLinks(user)).toThrow();
  });

  it('defines throttling metadata only for sensitive auth endpoints', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';
    const throttledEndpoints: Array<[object, number, number]> = [
      [AuthController.prototype.register, 3, 60_000],
      [AuthController.prototype.setup, 3, 60_000],
      [AuthController.prototype.login, 5, 60_000],
      [AuthController.prototype.forgotPassword, 3, 3_600_000],
      [AuthController.prototype.resetPassword, 5, 60_000],
      [AuthController.prototype.oidcGenerateState, 10, 60_000],
      [AuthController.prototype.oidcCallback, 5, 60_000],
      [AuthController.prototype.oidcGenerateLinkState, 5, 60_000],
      [AuthController.prototype.oidcGeneratePreviewState, 5, 60_000],
      [AuthController.prototype.createMagicLink, 5, 60_000],
      [AuthController.prototype.loginWithMagicLink, 10, 60_000],
    ];

    for (const [handler, limit, ttl] of throttledEndpoints) {
      expect(Reflect.getMetadata(limitKey, handler)).toBe(limit);
      expect(Reflect.getMetadata(ttlKey, handler)).toBe(ttl);
    }

    expect(Reflect.getMetadata(limitKey, AuthController.prototype.refresh)).toBeUndefined();
    expect(Reflect.getMetadata(limitKey, AuthController.prototype.logout)).toBeUndefined();
    expect(Reflect.getMetadata(limitKey, AuthController.prototype.me)).toBeUndefined();
    expect(Reflect.getMetadata(limitKey, AuthController.prototype.listMagicLinks)).toBeUndefined();
  });

  it('defines forbidden-permission metadata for account edit endpoints', () => {
    const changePasswordForbidden = Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AuthController.prototype.changePassword) as {
      permission: Permission;
      message?: string;
    };
    const oidcLinkForbidden = Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AuthController.prototype.oidcGenerateLinkState) as {
      permission: Permission;
      message?: string;
    };
    const oidcUnlinkForbidden = Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AuthController.prototype.oidcUnlinkIdentity) as {
      permission: Permission;
      message?: string;
    };

    expect(changePasswordForbidden).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot edit account settings',
    });
    expect(oidcLinkForbidden).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot edit account settings',
    });
    expect(oidcUnlinkForbidden).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot edit account settings',
    });
  });
});
