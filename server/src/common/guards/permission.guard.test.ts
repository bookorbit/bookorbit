import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { RequestUser } from '../types/request-user';
import { PermissionGuard } from './permission.guard';

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

function makeContext(user: RequestUser): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('allows @Public routes', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? true : undefined)),
    };
    const permissionService = { userHas: vi.fn() };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHas).not.toHaveBeenCalled();
  });

  it('allows routes without required permission metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? false : undefined)),
    };
    const permissionService = { userHas: vi.fn() };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHas).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when user lacks required permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSION_KEY) return Permission.ManageUsers;
        return undefined;
      }),
    };
    const permissionService = { userHas: vi.fn().mockReturnValue(false) };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow(ForbiddenException);
  });

  it('allows when permission service reports granted permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSION_KEY) return Permission.ManageUsers;
        return undefined;
      }),
    };
    const permissionService = { userHas: vi.fn().mockReturnValue(true) };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
  });
});
