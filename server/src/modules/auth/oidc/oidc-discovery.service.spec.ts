import { InternalServerErrorException } from '@nestjs/common';

import { OidcDiscoveryService } from './oidc-discovery.service';

const RAW_DOC = {
  issuer: 'https://idp.example.com',
  authorization_endpoint: 'https://idp.example.com/auth',
  token_endpoint: 'https://idp.example.com/token',
  jwks_uri: 'https://idp.example.com/jwks',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  end_session_endpoint: 'https://idp.example.com/logout',
  backchannel_logout_supported: true,
};

describe('OidcDiscoveryService', () => {
  let service: OidcDiscoveryService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new OidcDiscoveryService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mockFetchSuccess(body = RAW_DOC) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  it('fetches and normalizes the discovery document', async () => {
    mockFetchSuccess();

    const doc = await service.getDiscoveryDoc('https://idp.example.com');
    expect(doc.issuer).toBe('https://idp.example.com');
    expect(doc.authorizationEndpoint).toBe('https://idp.example.com/auth');
    expect(doc.tokenEndpoint).toBe('https://idp.example.com/token');
    expect(doc.jwksUri).toBe('https://idp.example.com/jwks');
    expect(doc.userinfoEndpoint).toBe('https://idp.example.com/userinfo');
    expect(doc.endSessionEndpoint).toBe('https://idp.example.com/logout');
    expect(doc.backchannelLogoutSupported).toBe(true);
  });

  it('strips trailing slash from issuerUri before fetching', async () => {
    mockFetchSuccess();
    await service.getDiscoveryDoc('https://idp.example.com/');
    expect(fetchMock).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration', expect.anything());
  });

  it('returns cached result on second call within TTL', async () => {
    mockFetchSuccess();
    await service.getDiscoveryDoc('https://idp.example.com');
    await service.getDiscoveryDoc('https://idp.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expires', async () => {
    mockFetchSuccess();
    await service.getDiscoveryDoc('https://idp.example.com');
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    await service.getDiscoveryDoc('https://idp.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws InternalServerErrorException on non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(service.getDiscoveryDoc('https://idp.example.com')).rejects.toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException on network error', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));
    await expect(service.getDiscoveryDoc('https://idp.example.com')).rejects.toThrow(InternalServerErrorException);
  });

  it('handles missing optional fields gracefully', async () => {
    const minimalDoc = {
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp.example.com/auth',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    };
    mockFetchSuccess(minimalDoc as never);
    const doc = await service.getDiscoveryDoc('https://idp.example.com');
    expect(doc.userinfoEndpoint).toBeUndefined();
    expect(doc.endSessionEndpoint).toBeUndefined();
    expect(doc.backchannelLogoutSupported).toBe(false);
  });
});
