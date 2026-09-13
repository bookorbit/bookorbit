import { ForbiddenException } from '@nestjs/common';

import { LoginErrorCode } from '@bookorbit/types';

import { AuthenticationPolicyService } from './authentication-policy.service';

function makeService(passwordLoginEnabled: boolean) {
  const tx = { execute: vi.fn() };
  const db = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
  const config = { get: vi.fn().mockReturnValue(passwordLoginEnabled) };
  return { service: new AuthenticationPolicyService(config as never, db as never), db, tx };
}

describe('AuthenticationPolicyService', () => {
  it('returns a stable error code when password authentication is disabled', () => {
    const { service } = makeService(false);

    expect(() => service.assertPasswordLoginEnabled()).toThrow(ForbiddenException);
    try {
      service.assertPasswordLoginEnabled();
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toEqual({
        message: 'Password authentication is disabled',
        errorCode: LoginErrorCode.PASSWORD_AUTH_DISABLED,
      });
    }
  });

  it('does not query administrator availability while password recovery is enabled', async () => {
    const { service, db } = makeService(true);

    await service.onApplicationBootstrap();

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('starts in SSO-only mode when an active superuser has an enabled OIDC identity', async () => {
    const { service, db } = makeService(false);
    vi.spyOn(service, 'hasUsableOidcSuperuser').mockResolvedValue(true);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('refuses to start in SSO-only mode without a usable OIDC administrator', async () => {
    const { service } = makeService(false);
    vi.spyOn(service, 'hasUsableOidcSuperuser').mockResolvedValue(false);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'DISABLE_LOCAL_AUTH requires at least one active superuser linked to an enabled OIDC provider',
    );
  });
});
