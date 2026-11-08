import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { ALLOW_DEFAULT_PASSWORD_KEY } from '../decorators/allow-default-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../types/request-user';
import { JwtAuthGuard, presentedApiKey } from './jwt-auth.guard';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'jdoe',
    name: 'Jane Doe',
    email: 'jdoe@example.com',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    authenticationMethod: 'password',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

const KEY = 'bok_' + 'a'.repeat(49);

function makeContext(type: 'http' | 'ws' = 'http', request: Record<string, unknown> = { headers: {} }) {
  return {
    getType: () => type,
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/v1/somewhere', ip: '10.0.0.9', ...request }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(reflector: unknown = { getAllAndOverride: vi.fn() }, authenticator: unknown = { authenticateApiKey: vi.fn() }) {
  return new JwtAuthGuard(reflector as never, authenticator as never);
}

describe('JwtAuthGuard', () => {
  /** The passport half of the guard, which reads a bearer token from HTTP headers. */
  const passportCanActivate = () => vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => unknown }, 'canActivate');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets gateway messages through without asking passport, which would read headers a socket does not have', async () => {
    const passport = passportCanActivate().mockReturnValue(false);
    const guard = makeGuard();

    await expect(guard.canActivate(makeContext('ws'))).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });

  it('still authenticates every non-public HTTP request through passport', async () => {
    const passport = passportCanActivate().mockResolvedValue(false);
    const guard = makeGuard({ getAllAndOverride: vi.fn().mockReturnValue(undefined) });
    const context = makeContext('http', { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' } });

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(passport).toHaveBeenCalledWith(context);
  });

  it('returns true in canActivate for @Public routes without reading any credential', async () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      }),
    };
    const authenticator = { authenticateApiKey: vi.fn() };
    const guard = makeGuard(reflector, authenticator);

    await expect(guard.canActivate(makeContext('http', { headers: { 'x-api-key': KEY } }))).resolves.toBe(true);
    expect(authenticator.authenticateApiKey).not.toHaveBeenCalled();
  });

  it('authenticates an API key itself and skips passport and the default-password gate', async () => {
    const passport = passportCanActivate();
    const keyUser = makeUser({ isDefaultPassword: false, authenticationMethod: 'api_key' });
    const authenticator = { authenticateApiKey: vi.fn().mockResolvedValue(keyUser) };
    const guard = makeGuard({ getAllAndOverride: vi.fn() }, authenticator);
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${KEY}` } };

    await expect(guard.canActivate(makeContext('http', request))).resolves.toBe(true);
    expect(authenticator.authenticateApiKey).toHaveBeenCalledWith(KEY, '10.0.0.9');
    expect(passport).not.toHaveBeenCalled();
  });

  it('refuses two credentials that disagree instead of choosing one', async () => {
    const authenticator = { authenticateApiKey: vi.fn() };
    const guard = makeGuard({ getAllAndOverride: vi.fn() }, authenticator);
    const request = { headers: { 'x-api-key': KEY, authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' } };

    await expect(guard.canActivate(makeContext('http', request))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticator.authenticateApiKey).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when passport strategy returns an error', () => {
    const reflector = { getAllAndOverride: vi.fn() };
    const guard = makeGuard(reflector);

    expect(() => guard.handleRequest(new Error('boom'), makeUser(), undefined, makeContext())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when no authenticated user is present', () => {
    const reflector = { getAllAndOverride: vi.fn() };
    const guard = makeGuard(reflector);

    expect(() => guard.handleRequest(undefined, undefined as never, undefined, makeContext())).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException for default-password users on routes without allow metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === ALLOW_DEFAULT_PASSWORD_KEY) return undefined;
        return false;
      }),
    };
    const guard = makeGuard(reflector);

    expect(() => guard.handleRequest(undefined, makeUser({ isDefaultPassword: true }), undefined, makeContext())).toThrow(ForbiddenException);
  });

  it('allows default-password users on routes with allow metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === ALLOW_DEFAULT_PASSWORD_KEY) return true;
        return false;
      }),
    };
    const guard = makeGuard(reflector);
    const user = makeUser({ isDefaultPassword: true });

    const result = guard.handleRequest(undefined, user, undefined, makeContext());
    expect(result).toBe(user);
  });

  it('does not force a password change for an OIDC-authenticated session', () => {
    const reflector = { getAllAndOverride: vi.fn() };
    const guard = makeGuard(reflector);

    expect(() =>
      guard.handleRequest(undefined, makeUser({ isDefaultPassword: true, authenticationMethod: 'oidc' }), undefined, makeContext()),
    ).not.toThrow();
  });
});

describe('presentedApiKey', () => {
  it('reads a key from either header and leaves session tokens to passport', () => {
    expect(presentedApiKey({ 'x-api-key': KEY })).toEqual({ kind: 'key', token: KEY });
    expect(presentedApiKey({ authorization: `Bearer ${KEY}` })).toEqual({ kind: 'key', token: KEY });
    expect(presentedApiKey({ authorization: `bearer ${KEY}` })).toEqual({ kind: 'key', token: KEY });
    expect(presentedApiKey({ authorization: 'Bearer eyJ.a.b' })).toEqual({ kind: 'none' });
    expect(presentedApiKey({})).toEqual({ kind: 'none' });
  });

  it('accepts the same key in both headers and refuses anything that disagrees', () => {
    expect(presentedApiKey({ 'x-api-key': KEY, authorization: `Bearer ${KEY}` })).toEqual({ kind: 'key', token: KEY });
    expect(presentedApiKey({ 'x-api-key': KEY, authorization: 'Bearer eyJ.a.b' })).toEqual({ kind: 'conflict' });
    expect(presentedApiKey({ 'x-api-key': KEY, authorization: 'Basic dTpw' })).toEqual({ kind: 'conflict' });
    expect(presentedApiKey({ 'x-api-key': [KEY, KEY] as never })).toEqual({ kind: 'conflict' });
  });
});
