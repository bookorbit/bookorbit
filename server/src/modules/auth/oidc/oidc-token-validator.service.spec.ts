import { UnauthorizedException } from '@nestjs/common';

import { OidcTokenValidatorService } from './oidc-token-validator.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue('mocked-jwks'),
  jwtVerify: jest.fn(),
}));

import { createRemoteJWKSet, jwtVerify } from 'jose';

const VALIDATE_ID_TOKEN_OPTS = {
  issuer: 'https://idp.example.com',
  clientId: 'client-id',
  nonce: 'test-nonce',
  jwksUri: 'https://idp.example.com/jwks',
};

const VALIDATE_LOGOUT_TOKEN_OPTS = {
  issuer: 'https://idp.example.com',
  clientId: 'client-id',
  jwksUri: 'https://idp.example.com/jwks',
};

describe('OidcTokenValidatorService', () => {
  let service: OidcTokenValidatorService;

  beforeEach(() => {
    service = new OidcTokenValidatorService();
    jest.clearAllMocks();
    (createRemoteJWKSet as jest.Mock).mockReturnValue('mocked-jwks');
  });

  describe('validateIdToken', () => {
    it('returns payload for valid token with matching nonce', async () => {
      const payload = { sub: 'u1', nonce: 'test-nonce', iss: 'https://idp.example.com', aud: 'client-id' };
      (jwtVerify as jest.Mock).mockResolvedValue({ payload });

      const result = await service.validateIdToken('valid-token', VALIDATE_ID_TOKEN_OPTS);
      expect(result).toEqual(payload);
    });

    it('throws UnauthorizedException when nonce does not match', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { sub: 'u1', nonce: 'wrong-nonce' } });

      await expect(service.validateIdToken('token', VALIDATE_ID_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when jwtVerify fails', async () => {
      (jwtVerify as jest.Mock).mockRejectedValue(new Error('signature invalid'));

      await expect(service.validateIdToken('bad-token', VALIDATE_ID_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });

    it('re-throws UnauthorizedException from inside jwtVerify as-is', async () => {
      const inner = new UnauthorizedException('custom message');
      (jwtVerify as jest.Mock).mockRejectedValue(inner);

      await expect(service.validateIdToken('token', VALIDATE_ID_TOKEN_OPTS)).rejects.toThrow('custom message');
    });

    it('uses cached JWKS within TTL', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { nonce: 'test-nonce' } });
      jest.useFakeTimers();

      await service.validateIdToken('t1', VALIDATE_ID_TOKEN_OPTS);
      await service.validateIdToken('t2', VALIDATE_ID_TOKEN_OPTS);

      expect(createRemoteJWKSet).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('recreates JWKS after TTL expires', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { nonce: 'test-nonce' } });
      jest.useFakeTimers();

      await service.validateIdToken('t1', VALIDATE_ID_TOKEN_OPTS);
      jest.advanceTimersByTime(6 * 3600 * 1000 + 1);
      await service.validateIdToken('t2', VALIDATE_ID_TOKEN_OPTS);

      expect(createRemoteJWKSet).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('validateLogoutToken', () => {
    const backchannelEvent = { 'http://schemas.openid.net/event/backchannel-logout': {} };

    it('returns payload for valid logout token', async () => {
      const payload = { sub: 'u1', jti: 'jti-1', events: backchannelEvent };
      (jwtVerify as jest.Mock).mockResolvedValue({ payload });

      const result = await service.validateLogoutToken('logout-token', VALIDATE_LOGOUT_TOKEN_OPTS);
      expect(result).toEqual(payload);
    });

    it('throws UnauthorizedException when backchannel-logout event is missing', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { sub: 'u1', events: {} } });

      await expect(service.validateLogoutToken('token', VALIDATE_LOGOUT_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when events field is absent', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { sub: 'u1' } });

      await expect(service.validateLogoutToken('token', VALIDATE_LOGOUT_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when logout token contains nonce', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({ payload: { sub: 'u1', events: backchannelEvent, nonce: 'should-not-be-here' } });

      await expect(service.validateLogoutToken('token', VALIDATE_LOGOUT_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when jwtVerify fails', async () => {
      (jwtVerify as jest.Mock).mockRejectedValue(new Error('expired'));

      await expect(service.validateLogoutToken('bad-token', VALIDATE_LOGOUT_TOKEN_OPTS)).rejects.toThrow(UnauthorizedException);
    });
  });
});
