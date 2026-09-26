import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';

const raw = 'a'.repeat(64);
const credentials = {
  accessToken: 'access',
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: 'b'.repeat(64),
  refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
  sessionId: 7,
};
const user = { id: 2, tokenVersion: 3, active: true, username: 'reader', provisioningMethod: 'local', permissions: [] };

async function fixture() {
  const repository = {
    findRefresh: vi.fn().mockResolvedValue({ id: 10, sessionId: 7, userId: 2, authenticationMethod: 'password' }),
    findSession: vi.fn().mockResolvedValue({ id: 7, userId: 2, clientKind: 'native' }),
    revoke: vi.fn(),
    isActive: vi.fn().mockResolvedValue(true),
    list: vi.fn(),
  };
  const sessions = { issue: vi.fn().mockResolvedValue(credentials), refresh: vi.fn().mockResolvedValue(credentials) };
  const users = { findByIdWithPermissions: vi.fn().mockResolvedValue(user), incrementTokenVersion: vi.fn() };
  const policy = { isPasswordLoginEnabled: vi.fn().mockReturnValue(true) };
  const magic = { hasActiveByUserId: vi.fn().mockResolvedValue(true) };
  const mocks: Record<string, unknown> = {
    AuthSessionRepository: repository,
    AuthSessionService: sessions,
    UserService: users,
    AuthenticationPolicyService: policy,
    MagicLinkRepository: magic,
    AuditEventsService: { emit: vi.fn() },
    ConfigService: { get: (key: string) => (key === 'auth.jwtExpiresIn' ? '15m' : undefined) },
  };
  const module = await Test.createTestingModule({ providers: [AuthService] })
    .useMocker((token) => (typeof token === 'function' ? (mocks[token.name] ?? {}) : {}))
    .compile();
  const reply = { setCookie: vi.fn(), header: vi.fn() };
  const request = (cookie?: string) => ({ cookies: cookie ? { refresh_token: cookie } : {}, ip: '127.0.0.1' }) as FastifyRequest;
  return {
    service: module.get(AuthService),
    repository,
    sessions,
    users,
    policy,
    magic,
    reply,
    req: request(),
    request,
    res: reply as unknown as FastifyReply,
  };
}

describe('Auth native and web transports', () => {
  it('returns all native credentials without setting cookies', async () => {
    const { service, reply, res } = await fixture();
    expect(await service.issueTokensForUser(2, res, 'oidc', { clientKind: 'native' })).toMatchObject(credentials);
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('keeps web refresh credentials out of JSON and in an HttpOnly cookie', async () => {
    const { service, reply, res } = await fixture();
    const result = await service.issueTokensForUser(2, res, 'password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result.sessionId).toBe(7);
    expect(reply.setCookie).toHaveBeenCalledWith(
      'refresh_token',
      credentials.refreshToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('refreshes with an explicit credential and returns its replacement', async () => {
    const { service, sessions, req, res, reply } = await fixture();
    expect(await service.refresh(req, res, { refreshToken: raw })).toEqual(credentials);
    expect(sessions.refresh).toHaveBeenCalledWith(raw, 2, 3, 7);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'logout'] as const)('rejects conflicting cookie/body credentials on %s', async (method) => {
    const { service, request, res, repository } = await fixture();
    await expect(service[method](request('c'.repeat(64)), res, { refreshToken: raw })).rejects.toThrow(BadRequestException);
    expect(repository.findRefresh).not.toHaveBeenCalled();
  });

  it('does not turn a web session into a native refresh response', async () => {
    const { service, req, res, repository, sessions } = await fixture();
    repository.findSession.mockResolvedValue({ id: 7, userId: 2, clientKind: 'web' });
    await expect(service.refresh(req, res, { refreshToken: raw })).rejects.toThrow(UnauthorizedException);
    expect(sessions.refresh).not.toHaveBeenCalled();
  });

  it.each([null, { userId: 2, sessionId: null }])('rejects missing and pre-migration refresh sessions', async (row) => {
    const { service, req, res, repository } = await fixture();
    repository.findRefresh.mockResolvedValue(row);
    await expect(service.refresh(req, res, { refreshToken: raw })).rejects.toThrow(UnauthorizedException);
  });

  it('revokes password sessions when password authentication is disabled', async () => {
    const { service, req, res, policy, repository, sessions } = await fixture();
    policy.isPasswordLoginEnabled.mockReturnValue(false);
    await expect(service.refresh(req, res, { refreshToken: raw })).rejects.toThrow(UnauthorizedException);
    expect(repository.revoke).toHaveBeenCalledWith(7, 2);
    expect(sessions.refresh).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'shared-without-link'])('refuses refresh for %s accounts', async (reason) => {
    const { service, req, res, users, magic, sessions } = await fixture();
    users.findByIdWithPermissions.mockResolvedValue({ ...user, active: reason !== 'disabled', provisioningMethod: 'shared' });
    magic.hasActiveByUserId.mockResolvedValue(false);
    await expect(service.refresh(req, res, { refreshToken: raw })).rejects.toThrow(UnauthorizedException);
    expect(sessions.refresh).not.toHaveBeenCalled();
  });

  it('logout revokes this session without incrementing the account token version or starting IdP logout', async () => {
    const { service, req, res, users, repository } = await fixture();
    expect(await service.logout(req, res, { refreshToken: raw })).toEqual({});
    expect(repository.revoke).toHaveBeenCalledWith(7, 2);
    expect(users.incrementTokenVersion).not.toHaveBeenCalled();
  });

  it('denies another user device revocation', async () => {
    const { service, repository } = await fixture();
    await expect(service.revokeSession(3, 7)).rejects.toThrow(ForbiddenException);
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -1, 0.5])('rejects access tokens without a valid session ID: %s', async (id) => {
    const { service, repository } = await fixture();
    await expect(service.validateSessionUser(2, 3, 'password', id)).rejects.toThrow(UnauthorizedException);
    expect(repository.isActive).not.toHaveBeenCalled();
  });

  it('checks the session and account on every authenticated request', async () => {
    const { service, repository } = await fixture();
    expect(await service.validateSessionUser(2, 3, 'password', 7)).toMatchObject({ id: 2, sessionId: 7 });
    expect(repository.isActive).toHaveBeenCalledWith(7, 2, 3, 'password');
    repository.isActive.mockResolvedValue(false);
    await expect(service.validateSessionUser(2, 3, 'password', 7)).rejects.toThrow(UnauthorizedException);
  });

  it('keeps resource-ticket account validation independent of login session IDs', async () => {
    const { service, repository } = await fixture();
    expect(await service.validateUser(2, 3, 'password')).toMatchObject({ id: 2 });
    expect(repository.isActive).not.toHaveBeenCalled();
  });
});
