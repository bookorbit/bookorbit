import { Test } from '@nestjs/testing';
import { BackchannelLogoutService } from './backchannel-logout.service';

async function fixture() {
  const providerService = { findByIssuerUri: vi.fn().mockResolvedValue({ enabled: true, issuerUri: 'https://issuer.example', clientId: 'client' }) };
  const discovery = { getDiscoveryDoc: vi.fn().mockResolvedValue({ issuer: 'https://issuer.example', jwksUri: 'https://issuer.example/keys' }) };
  const validator = { validateLogoutToken: vi.fn().mockResolvedValue({ sub: 'subject', sid: 'provider-session', jti: 'logout-id' }) };
  const repository = { revokeProviderSessions: vi.fn().mockResolvedValue(2) };
  const returning = vi.fn().mockResolvedValue([{ jti: 'logout-id' }]);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing: () => ({ returning }) });
  const db = { insert: vi.fn().mockReturnValue({ values }), delete: vi.fn().mockReturnValue({ where: vi.fn() }) };
  const mocks: Record<string, unknown> = {
    OidcProviderService: providerService,
    OidcDiscoveryService: discovery,
    OidcTokenValidatorService: validator,
    OidcSessionRepository: repository,
  };
  const module = await Test.createTestingModule({ providers: [BackchannelLogoutService] })
    .useMocker((token) => (typeof token === 'function' ? mocks[token.name] : db))
    .compile();
  const token = `header.${Buffer.from(JSON.stringify({ iss: 'https://issuer.example' })).toString('base64url')}.signature`;
  return { service: module.get(BackchannelLogoutService), providerService, validator, repository, returning, values, db, token };
}

describe('Backchannel logout scope', () => {
  it('binds a provider session ID to its verified issuer', async () => {
    const { service, token, repository } = await fixture();
    await service.handleLogout(token);
    expect(repository.revokeProviderSessions).toHaveBeenCalledWith('https://issuer.example', { sid: 'provider-session' });
  });

  it('does not broaden an unknown sid into subject-wide logout', async () => {
    const { service, token, repository } = await fixture();
    repository.revokeProviderSessions.mockResolvedValue(0);
    await service.handleLogout(token);
    expect(repository.revokeProviderSessions).toHaveBeenCalledTimes(1);
    expect(repository.revokeProviderSessions).toHaveBeenCalledWith('https://issuer.example', { sid: 'provider-session' });
  });

  it('uses subject-wide logout only when the provider omitted sid', async () => {
    const { service, token, validator, repository } = await fixture();
    validator.validateLogoutToken.mockResolvedValue({ sub: 'subject' });
    await service.handleLogout(token);
    expect(repository.revokeProviderSessions).toHaveBeenCalledWith('https://issuer.example', { subject: 'subject' });
  });

  it('rejects replayed logout tokens', async () => {
    const { service, token, returning, repository } = await fixture();
    returning.mockResolvedValue([]);
    await service.handleLogout(token);
    expect(repository.revokeProviderSessions).not.toHaveBeenCalled();
  });

  it('stores JTI expiry and prunes expired replay records', async () => {
    const { service, token, validator, values, db } = await fixture();
    validator.validateLogoutToken.mockResolvedValue({ sub: 'subject', jti: 'new-id', exp: 1_800_000_000 });
    await service.handleLogout(token);
    expect(values).toHaveBeenCalledWith({ jti: 'new-id', expiresAt: new Date(1_800_000_000_000) });
    expect(db.delete).toHaveBeenCalled();
  });

  it.each([null, { enabled: false }])('ignores unknown and disabled providers', async (provider) => {
    const { service, token, providerService, validator } = await fixture();
    providerService.findByIssuerUri.mockResolvedValue(provider);
    await service.handleLogout(token);
    expect(validator.validateLogoutToken).not.toHaveBeenCalled();
  });

  it('does not revoke anything for an invalid provider signature', async () => {
    const { service, token, validator, repository } = await fixture();
    validator.validateLogoutToken.mockRejectedValue(new Error('invalid signature'));
    await expect(service.handleLogout(token)).rejects.toThrow('invalid signature');
    expect(repository.revokeProviderSessions).not.toHaveBeenCalled();
  });
});
