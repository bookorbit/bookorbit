import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../decorators/forbid-permission.decorator';
import { ANY_PERMISSION_KEY } from '../decorators/require-any-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { RequestUser } from '../types/request-user';
import { PermissionGuard } from './permission.guard';
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
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
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
    const permissionService = { userHas: vi.fn(), userHasExplicit: vi.fn() };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHas).not.toHaveBeenCalled();
    expect(permissionService.userHasExplicit).not.toHaveBeenCalled();
  });

  it('allows routes without required permission metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? false : undefined)),
    };
    const permissionService = { userHas: vi.fn(), userHasExplicit: vi.fn() };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHas).not.toHaveBeenCalled();
    expect(permissionService.userHasExplicit).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when forbidden marker permission is present', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === FORBIDDEN_PERMISSION_KEY) {
          return {
            permission: Permission.DemoRestricted,
            message: 'Demo-restricted account cannot perform bulk edits',
          };
        }
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn(),
      userHasExplicit: vi.fn().mockReturnValue(true),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow('Demo-restricted account cannot perform bulk edits');
    expect(permissionService.userHas).not.toHaveBeenCalled();
  });

  it('evaluates required permission when user does not have the forbidden marker permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === FORBIDDEN_PERMISSION_KEY) {
          return {
            permission: Permission.DemoRestricted,
          };
        }
        if (key === PERMISSION_KEY) return [Permission.ManageUsers];
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn().mockReturnValue(true),
      userHasExplicit: vi.fn().mockReturnValue(false),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHasExplicit).toHaveBeenCalledWith(expect.any(Object), Permission.DemoRestricted);
    expect(permissionService.userHas).toHaveBeenCalledWith(expect.any(Object), Permission.ManageUsers);
  });

  it('uses default fallback message when ForbidPermission has no custom message', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === FORBIDDEN_PERMISSION_KEY) return { permission: Permission.DemoRestricted };
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn(),
      userHasExplicit: vi.fn().mockReturnValue(true),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow(`Forbidden permission: ${Permission.DemoRestricted}`);
  });

  it('throws ForbiddenException when user lacks required permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSION_KEY) return [Permission.ManageUsers];
        return undefined;
      }),
    };
    const permissionService = { userHas: vi.fn().mockReturnValue(false), userHasExplicit: vi.fn().mockReturnValue(false) };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow(ForbiddenException);
  });

  it('allows when permission service reports granted permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSION_KEY) return [Permission.ManageUsers];
        return undefined;
      }),
    };
    const permissionService = { userHas: vi.fn().mockReturnValue(true), userHasExplicit: vi.fn().mockReturnValue(false) };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
  });

  it('accepts any one of an any-of set', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ANY_PERMISSION_KEY) return [Permission.BookRequestAccess, Permission.ManageAppSettings];
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn((_user: RequestUser, permission: Permission) => permission === Permission.ManageAppSettings),
      userHasExplicit: vi.fn().mockReturnValue(false),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
  });

  it('refuses an any-of set the user holds none of, and names them all', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ANY_PERMISSION_KEY) return [Permission.BookRequestAccess, Permission.ManageAppSettings];
        return undefined;
      }),
    };
    const permissionService = { userHas: vi.fn().mockReturnValue(false), userHasExplicit: vi.fn().mockReturnValue(false) };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow(
      `Missing permission: ${Permission.BookRequestAccess} or ${Permission.ManageAppSettings}`,
    );
  });

  /** A handler naming an any-of set answers for it instead of its controller's class-level rule. */
  it('lets an any-of set stand in for the class-level requirement', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ANY_PERMISSION_KEY) return [Permission.BookRequestAccess, Permission.ManageAppSettings];
        if (key === PERMISSION_KEY) return Permission.ManageUsers;
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn((_user: RequestUser, permission: Permission) => permission === Permission.ManageAppSettings),
      userHasExplicit: vi.fn().mockReturnValue(false),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
    expect(permissionService.userHas).not.toHaveBeenCalledWith(expect.any(Object), Permission.ManageUsers);
  });

  it('requires every permission attached to a route', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSION_KEY) return [Permission.BookDockAccess, Permission.LibraryUpload];
        return undefined;
      }),
    };
    const permissionService = {
      userHas: vi.fn((_user: RequestUser, permission: Permission) => permission === Permission.BookDockAccess),
      userHasExplicit: vi.fn().mockReturnValue(false),
    };
    const guard = new PermissionGuard(reflector as never, permissionService as never);

    expect(() => guard.canActivate(makeContext(makeUser()))).toThrow(`Missing permission: ${Permission.LibraryUpload}`);
    expect(permissionService.userHas).toHaveBeenCalledWith(expect.any(Object), Permission.BookDockAccess);
    expect(permissionService.userHas).toHaveBeenCalledWith(expect.any(Object), Permission.LibraryUpload);
  });
});
