import { BadRequestException } from '@nestjs/common';

import { OidcProviderRepository } from './oidc-provider.repository';

const PROVIDER = {
  id: 1,
  slug: 'sso',
  displayName: 'SSO',
  enabled: true,
  issuerUri: 'https://issuer.example',
  clientId: 'client',
  clientSecret: 'secret',
  scopes: 'openid',
  iconUrl: null,
  claimMapping: {},
  autoProvision: {},
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRepository(linkedIdentityCount = 0) {
  const updateReturning = vi.fn().mockResolvedValue([PROVIDER]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const deleteReturning = vi.fn().mockResolvedValue([PROVIDER]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const countWhere = vi.fn().mockResolvedValue([{ count: linkedIdentityCount }]);
  const tx = {
    query: { oidcProviders: { findFirst: vi.fn().mockResolvedValue(PROVIDER) } },
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: countWhere }) }),
  };
  const db = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
  const policy = {
    lockAdministratorAvailability: vi.fn(),
    assertProviderAuthenticationCanChange: vi.fn(),
    assertUsableOidcSuperuser: vi.fn(),
  };
  return { repository: new OidcProviderRepository(db as never, policy as never), policy };
}

describe('OidcProviderRepository administrator availability', () => {
  it('allows non-authentication edits when the form resubmits unchanged authentication fields', async () => {
    const { repository, policy } = makeRepository();

    await repository.update(1, {
      displayName: 'Renamed',
      enabled: PROVIDER.enabled,
      issuerUri: PROVIDER.issuerUri,
      clientId: PROVIDER.clientId,
      scopes: PROVIDER.scopes,
    });

    expect(policy.assertProviderAuthenticationCanChange).not.toHaveBeenCalled();
    expect(policy.assertUsableOidcSuperuser).toHaveBeenCalledOnce();
  });

  it('checks administrator availability before changing an authentication-critical field', async () => {
    const { repository, policy } = makeRepository();

    await repository.update(1, { enabled: false });

    expect(policy.assertProviderAuthenticationCanChange).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('refuses provider deletion when identities are linked inside the same locked transaction', async () => {
    const { repository, policy } = makeRepository(2);

    await expect(repository.remove(1)).rejects.toThrow(BadRequestException);
    expect(policy.lockAdministratorAvailability).toHaveBeenCalledOnce();
    expect(policy.assertUsableOidcSuperuser).not.toHaveBeenCalled();
  });

  it('rechecks administrator availability after deleting an unlinked provider', async () => {
    const { repository, policy } = makeRepository();

    await expect(repository.remove(1)).resolves.toMatchObject({ id: 1 });
    expect(policy.assertUsableOidcSuperuser).toHaveBeenCalledOnce();
  });
});
