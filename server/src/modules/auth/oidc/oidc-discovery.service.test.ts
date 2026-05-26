import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

vi.mock('../../../common/utils/ssrf.utils', () => ({
  ensureSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

import { ensureSafeUrl } from '../../../common/utils/ssrf.utils';
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

function makeService(nodeEnv = 'development', oidcAllowLocalIssuers = false) {
  const configService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'app.nodeEnv') return nodeEnv;
      if (key === 'app.oidcAllowLocalIssuers') return oidcAllowLocalIssuers;
      return undefined;
    }),
  };
  return new OidcDiscoveryService(configService as never);
}

describe('OidcDiscoveryService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.useFakeTimers();
    vi.mocked(ensureSafeUrl).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchSuccess(body = RAW_DOC) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  it('fetches and normalizes the discovery document', async () => {
    mockFetchSuccess();
    const service = makeService();

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
    const service = makeService();
    await service.getDiscoveryDoc('https://idp.example.com/');
    expect(fetchMock).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration', expect.anything());
  });

  it('returns cached result on second call within TTL', async () => {
    mockFetchSuccess();
    const service = makeService();
    await service.getDiscoveryDoc('https://idp.example.com');
    await service.getDiscoveryDoc('https://idp.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expires', async () => {
    mockFetchSuccess();
    const service = makeService();
    await service.getDiscoveryDoc('https://idp.example.com');
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await service.getDiscoveryDoc('https://idp.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws InternalServerErrorException on non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const service = makeService();
    await expect(service.getDiscoveryDoc('https://idp.example.com')).rejects.toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException on network error', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));
    const service = makeService();
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
    const service = makeService();
    const doc = await service.getDiscoveryDoc('https://idp.example.com');
    expect(doc.userinfoEndpoint).toBeUndefined();
    expect(doc.endSessionEndpoint).toBeUndefined();
    expect(doc.backchannelLogoutSupported).toBe(false);
  });

  it('uses redirect:error to prevent redirect-based SSRF', async () => {
    mockFetchSuccess();
    const service = makeService();
    await service.getDiscoveryDoc('https://idp.example.com');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });

  describe('P0-3: issuer validation', () => {
    it('throws when discovery doc issuer does not match requested URI', async () => {
      const mismatchedDoc = { ...RAW_DOC, issuer: 'https://attacker.example.com' };
      mockFetchSuccess(mismatchedDoc);
      const service = makeService();
      await expect(service.getDiscoveryDoc('https://idp.example.com')).rejects.toThrow(InternalServerErrorException);
    });

    it('accepts issuer with trailing slash on either side', async () => {
      const docWithSlash = { ...RAW_DOC, issuer: 'https://idp.example.com/' };
      mockFetchSuccess(docWithSlash);
      const service = makeService();
      await expect(service.getDiscoveryDoc('https://idp.example.com/')).resolves.toBeDefined();
    });

    it('accepts exact match between issuerUri and discovery doc issuer', async () => {
      mockFetchSuccess();
      const service = makeService();
      await expect(service.getDiscoveryDoc('https://idp.example.com')).resolves.toBeDefined();
    });

    it('accepts issuer with sub-path (e.g. Keycloak realm)', async () => {
      const keycloakDoc = {
        ...RAW_DOC,
        issuer: 'http://localhost:8080/realms/bookorbit',
        authorization_endpoint: 'http://localhost:8080/realms/bookorbit/auth',
        token_endpoint: 'http://localhost:8080/realms/bookorbit/token',
        jwks_uri: 'http://localhost:8080/realms/bookorbit/jwks',
        userinfo_endpoint: undefined,
        end_session_endpoint: undefined,
      };
      mockFetchSuccess(keycloakDoc as never);
      const service = makeService();
      await expect(service.getDiscoveryDoc('http://localhost:8080/realms/bookorbit')).resolves.toBeDefined();
    });
  });

  describe('P0-4: endpoint SSRF validation', () => {
    it('calls ensureSafeUrl on token_endpoint', async () => {
      mockFetchSuccess();
      const service = makeService();
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith('https://idp.example.com/token', expect.any(Object));
    });

    it('calls ensureSafeUrl on jwks_uri', async () => {
      mockFetchSuccess();
      const service = makeService();
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith('https://idp.example.com/jwks', expect.any(Object));
    });

    it('calls ensureSafeUrl on userinfo_endpoint when present', async () => {
      mockFetchSuccess();
      const service = makeService();
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith('https://idp.example.com/userinfo', expect.any(Object));
    });

    it('calls ensureSafeUrl on end_session_endpoint when present', async () => {
      mockFetchSuccess();
      const service = makeService();
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith('https://idp.example.com/logout', expect.any(Object));
    });

    it('skips ensureSafeUrl for optional endpoints when absent', async () => {
      const minimalDoc = {
        issuer: 'https://idp.example.com',
        authorization_endpoint: 'https://idp.example.com/auth',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/jwks',
      };
      mockFetchSuccess(minimalDoc as never);
      const service = makeService();
      vi.mocked(ensureSafeUrl).mockClear();
      await service.getDiscoveryDoc('https://idp.example.com');
      // Only token + jwks called, not userinfo or end_session
      const calls = vi.mocked(ensureSafeUrl).mock.calls.map(([url]) => url);
      expect(calls).not.toContain('https://idp.example.com/userinfo');
      expect(calls).not.toContain('https://idp.example.com/logout');
    });

    it('throws InternalServerErrorException when an endpoint fails SSRF check', async () => {
      mockFetchSuccess();
      vi.mocked(ensureSafeUrl).mockRejectedValueOnce(new BadRequestException('URL host is not allowed'));
      const service = makeService();
      await expect(service.getDiscoveryDoc('https://idp.example.com')).rejects.toThrow(InternalServerErrorException);
    });

    it('passes allowLocal=true in non-production environments', async () => {
      mockFetchSuccess();
      const service = makeService('development');
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith(expect.any(String), { allowLocal: true, allowPrivate: true });
    });

    it('passes allowLocal=false in production environment', async () => {
      mockFetchSuccess();
      const service = makeService('production');
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith(expect.any(String), { allowLocal: false, allowPrivate: false });
    });

    it('passes allowLocal=true in production when OIDC_ALLOW_LOCAL_ISSUERS override is enabled', async () => {
      mockFetchSuccess();
      const service = makeService('production', true);
      await service.getDiscoveryDoc('https://idp.example.com');
      expect(ensureSafeUrl).toHaveBeenCalledWith(expect.any(String), { allowLocal: true, allowPrivate: true });
    });
  });
});
