import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { ALLOW_DEFAULT_PASSWORD_KEY } from '../decorators/allow-default-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../types/request-user';
import { JwtAuthGuard } from './jwt-auth.guard';

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
    permissions: [],
    ...overrides,
  };
}

function makeContext() {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/v1/somewhere' }),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('returns true in canActivate for @Public routes', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      }),
    };
    const guard = new JwtAuthGuard(reflector as never);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('throws UnauthorizedException when passport strategy returns an error', () => {
    const reflector = { getAllAndOverride: vi.fn() };
    const guard = new JwtAuthGuard(reflector as never);

    expect(() => guard.handleRequest(new Error('boom'), makeUser(), undefined, makeContext())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when no authenticated user is present', () => {
    const reflector = { getAllAndOverride: vi.fn() };
    const guard = new JwtAuthGuard(reflector as never);

    expect(() => guard.handleRequest(undefined, undefined as never, undefined, makeContext())).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException for default-password users on routes without allow metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === ALLOW_DEFAULT_PASSWORD_KEY) return undefined;
        return false;
      }),
    };
    const guard = new JwtAuthGuard(reflector as never);

    expect(() => guard.handleRequest(undefined, makeUser({ isDefaultPassword: true }), undefined, makeContext())).toThrow(ForbiddenException);
  });

  it('allows default-password users on routes with allow metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === ALLOW_DEFAULT_PASSWORD_KEY) return true;
        return false;
      }),
    };
    const guard = new JwtAuthGuard(reflector as never);
    const user = makeUser({ isDefaultPassword: true });

    const result = guard.handleRequest(undefined, user, undefined, makeContext());
    expect(result).toBe(user);
  });
});
