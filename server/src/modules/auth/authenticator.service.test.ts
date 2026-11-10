import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthenticatorService } from './authenticator.service';

const SECRET = 'authenticator-test-secret';

function makeAuthenticator() {
  const jwtService = new JwtService({ secret: SECRET });
  const authService = { validateSessionUser: vi.fn() };
  const apiKeys = { authenticate: vi.fn() };
  return { authenticator: new AuthenticatorService(jwtService, authService as never, apiKeys as never), jwtService, authService, apiKeys };
}

function socketWith(auth: Record<string, unknown> | undefined) {
  return { handshake: { auth, address: '10.1.1.1' } } as never;
}

describe('AuthenticatorService', () => {
  it('resolves a valid access token through the live session', async () => {
    const { authenticator, jwtService, authService } = makeAuthenticator();
    const user = { id: 7, sessionId: 11, credential: { kind: 'session', sessionId: 11 } };
    authService.validateSessionUser.mockResolvedValue(user);

    const token = jwtService.sign({ sub: 7, ver: 3, sid: 11, amr: 'password' });

    await expect(authenticator.authenticateAccessToken(token)).resolves.toBe(user);
    expect(authService.validateSessionUser).toHaveBeenCalledWith(7, 3, 'password', 11);
  });

  it('treats a token without a method as legacy', async () => {
    const { authenticator, authService } = makeAuthenticator();
    authService.validateSessionUser.mockResolvedValue({ id: 7 });

    await authenticator.authenticatePayload({ sub: 7, ver: 3, sid: 11 });

    expect(authService.validateSessionUser).toHaveBeenCalledWith(7, 3, 'legacy', 11);
  });

  it('rejects an expired token with the error a client re-authenticates from', async () => {
    const { authenticator, jwtService, authService } = makeAuthenticator();
    const token = jwtService.sign({ sub: 7, ver: 3, sid: 11 }, { expiresIn: -10 });

    await expect(authenticator.authenticateAccessToken(token)).rejects.toMatchObject({ name: 'TokenExpiredError' });
    expect(authService.validateSessionUser).not.toHaveBeenCalled();
  });

  it('rejects a token signed with another algorithm', async () => {
    const { authenticator, authService } = makeAuthenticator();
    const token = new JwtService({ secret: SECRET }).sign({ sub: 7, ver: 3, sid: 11 }, { algorithm: 'HS512' });

    await expect(authenticator.authenticateAccessToken(token)).rejects.toMatchObject({ name: 'JsonWebTokenError' });
    expect(authService.validateSessionUser).not.toHaveBeenCalled();
  });

  it('passes on a refusal of a revoked session, a bumped version, an inactive user or a disallowed method', async () => {
    const { authenticator, jwtService, authService } = makeAuthenticator();
    authService.validateSessionUser.mockRejectedValue(new UnauthorizedException());

    await expect(authenticator.authenticateAccessToken(jwtService.sign({ sub: 7, ver: 3, sid: 11 }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a socket without a string token before verifying anything', async () => {
    const { authenticator, authService } = makeAuthenticator();

    await expect(authenticator.authenticateSocket(socketWith(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(authenticator.authenticateSocket(socketWith({ token: '' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(authenticator.authenticateSocket(socketWith({ token: ['a'] }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.validateSessionUser).not.toHaveBeenCalled();
  });

  it('authenticates a socket handshake token like an HTTP request', async () => {
    const { authenticator, jwtService, authService } = makeAuthenticator();
    authService.validateSessionUser.mockResolvedValue({ id: 7 });

    await expect(authenticator.authenticateSocket(socketWith({ token: jwtService.sign({ sub: 7, ver: 3, sid: 11 }) }))).resolves.toEqual({ id: 7 });
  });

  it('authenticates an API key presented on a socket handshake through the key authenticator', async () => {
    const { authenticator, apiKeys, authService } = makeAuthenticator();
    apiKeys.authenticate.mockResolvedValue({ id: 7, credential: { kind: 'api_key' } });
    const key = 'bok_' + 'a'.repeat(49);

    await expect(authenticator.authenticateSocket(socketWith({ token: key }))).resolves.toMatchObject({ id: 7 });
    expect(apiKeys.authenticate).toHaveBeenCalledWith(key, '10.1.1.1');
    expect(authService.validateSessionUser).not.toHaveBeenCalled();
  });
});
