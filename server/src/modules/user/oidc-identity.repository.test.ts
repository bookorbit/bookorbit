import { ConflictException } from '@nestjs/common';

import { OidcIdentityRepository } from './oidc-identity.repository';

function makeRepository(options: { passwordLoginEnabled: boolean; userProvisioningMethod?: string; hasEnabledIdentity: boolean }) {
  const returning = vi.fn().mockResolvedValue([{ id: 4, userId: 7, providerId: 2 }]);
  const where = vi.fn().mockReturnValue({ returning });
  const tx = {
    delete: vi.fn().mockReturnValue({ where }),
    query: { users: { findFirst: vi.fn().mockResolvedValue({ id: 7, provisioningMethod: options.userProvisioningMethod ?? 'local' }) } },
  };
  const db = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
  const policy = {
    lockAdministratorAvailability: vi.fn(),
    isPasswordLoginEnabled: vi.fn().mockReturnValue(options.passwordLoginEnabled),
    hasEnabledOidcIdentityForUser: vi.fn().mockResolvedValue(options.hasEnabledIdentity),
    assertUsableOidcSuperuser: vi.fn(),
  };
  return { repository: new OidcIdentityRepository(db as never, policy as never), policy };
}

describe('OidcIdentityRepository', () => {
  it('rolls back unlinking the final enabled sign-in method in SSO-only mode', async () => {
    const { repository, policy } = makeRepository({ passwordLoginEnabled: false, hasEnabledIdentity: false });

    await expect(repository.remove(7, 2)).rejects.toThrow(ConflictException);
    expect(policy.lockAdministratorAvailability).toHaveBeenCalledOnce();
    expect(policy.assertUsableOidcSuperuser).not.toHaveBeenCalled();
  });

  it('allows unlinking when another enabled identity remains and rechecks administrator availability', async () => {
    const { repository, policy } = makeRepository({ passwordLoginEnabled: false, hasEnabledIdentity: true });

    await expect(repository.remove(7, 2)).resolves.toMatchObject({ id: 4 });
    expect(policy.assertUsableOidcSuperuser).toHaveBeenCalledOnce();
  });

  it('protects an OIDC-provisioned account from losing its final identity even when passwords are enabled', async () => {
    const { repository } = makeRepository({ passwordLoginEnabled: true, userProvisioningMethod: 'oidc', hasEnabledIdentity: false });

    await expect(repository.remove(7, 2)).rejects.toThrow('Cannot unlink the last enabled sign-in provider for this account');
  });
});
