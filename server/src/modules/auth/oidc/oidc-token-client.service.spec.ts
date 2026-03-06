import { InternalServerErrorException } from '@nestjs/common';

import { OidcTokenClientService } from './oidc-token-client.service';

const CODE_PARAMS = {
  code: 'auth-code-123',
  codeVerifier: 'verifier-abc',
  redirectUri: 'https://app.example.com/callback',
  tokenEndpoint: 'https://idp.example.com/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

describe('OidcTokenClientService', () => {
  let service: OidcTokenClientService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new OidcTokenClientService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('exchangeCode', () => {
    it('returns token response on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'access-token',
            id_token: 'id-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
      });

      const result = await service.exchangeCode(CODE_PARAMS);
      expect(result.accessToken).toBe('access-token');
      expect(result.idToken).toBe('id-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe(3600);
    });

    it('sends correct grant_type and parameters', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'a', id_token: 'i' }),
      });

      await service.exchangeCode(CODE_PARAMS);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(CODE_PARAMS.tokenEndpoint);
      expect(options.method).toBe('POST');
      const body = options.body as string;
      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain(`code=${CODE_PARAMS.code}`);
      expect(body).toContain(`client_id=${CODE_PARAMS.clientId}`);
    });

    it('throws InternalServerErrorException on non-OK response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });

      await expect(service.exchangeCode(CODE_PARAMS)).rejects.toThrow(InternalServerErrorException);
    });

    it('throws InternalServerErrorException on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'));
      await expect(service.exchangeCode(CODE_PARAMS)).rejects.toThrow();
    });

    it('handles missing optional fields in response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'a', id_token: 'i' }),
      });

      const result = await service.exchangeCode(CODE_PARAMS);
      expect(result.refreshToken).toBeUndefined();
      expect(result.expiresIn).toBeUndefined();
    });
  });

  describe('fetchUserInfo', () => {
    it('returns parsed user info on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sub: 'u1', email: 'user@example.com' }),
      });

      const result = await service.fetchUserInfo('https://idp.example.com/userinfo', 'access-token');
      expect(result.sub).toBe('u1');
      expect(result.email).toBe('user@example.com');
    });

    it('sends Authorization Bearer header', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await service.fetchUserInfo('https://idp.example.com/userinfo', 'my-token');
      const options = fetchMock.mock.calls[0][1];
      expect(options.headers.Authorization).toBe('Bearer my-token');
    });

    it('returns empty object on non-OK response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      const result = await service.fetchUserInfo('https://idp.example.com/userinfo', 'bad-token');
      expect(result).toEqual({});
    });

    it('returns empty object on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));
      const result = await service.fetchUserInfo('https://idp.example.com/userinfo', 'token');
      expect(result).toEqual({});
    });
  });
});
