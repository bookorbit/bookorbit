import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../types/request-user';
import { LibraryAccessGuard } from './library-access.guard';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { LIBRARY_ACCESS_KEY } from '../decorators/require-library-access.decorator';
import { LIBRARY_TYPE_KEY, OPTIONAL_LIBRARY_TYPE_KEY } from '../decorators/require-library-type.decorator';

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

function makeContext(user: RequestUser, params: Record<string, string> = {}, body?: { libraryId?: unknown }): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user, params, body }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(
  overrides: {
    required?: 'viewer' | 'editor' | 'owner' | undefined;
    requiredType?: 'books' | 'podcasts' | undefined;
    optionalType?: boolean;
    row?: { accessLevel: 'viewer' | 'editor' | 'owner' } | undefined;
    library?: { type: 'books' | 'podcasts' } | undefined;
  } = {},
) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === LIBRARY_ACCESS_KEY
        ? overrides.required
        : key === LIBRARY_TYPE_KEY
          ? overrides.requiredType
          : key === OPTIONAL_LIBRARY_TYPE_KEY
            ? overrides.optionalType
            : undefined,
    ),
  };
  const findFirst = vi.fn().mockResolvedValue(overrides.row);
  const findLibrary = vi.fn().mockResolvedValue(overrides.library);
  const db = {
    query: {
      userLibraryAccess: {
        findFirst,
      },
      libraries: {
        findFirst: findLibrary,
      },
    },
  };

  const guard = new LibraryAccessGuard(reflector as never, db as never);
  return { guard, findFirst, findLibrary };
}

describe('LibraryAccessGuard', () => {
  it('allows routes without required metadata', async () => {
    const { guard, findFirst } = makeGuard({ required: undefined });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '1' }))).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows superusers without querying access table', async () => {
    const { guard, findFirst } = makeGuard({ required: 'owner' });
    await expect(guard.canActivate(makeContext(makeUser({ isSuperuser: true }), { libraryId: '1' }))).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('enforces the required library type for superusers', async () => {
    const { guard, findFirst, findLibrary } = makeGuard({ requiredType: 'books', library: { type: 'podcasts' } });

    await expect(guard.canActivate(makeContext(makeUser({ isSuperuser: true }), { id: '1' }))).rejects.toThrow(
      'This endpoint requires a books library',
    );
    expect(findLibrary).toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when a type-guarded library does not exist', async () => {
    const { guard } = makeGuard({ requiredType: 'podcasts', library: undefined });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '99' }))).rejects.toThrow(NotFoundException);
  });

  it('allows the required library type before checking access', async () => {
    const { guard } = makeGuard({ required: 'viewer', requiredType: 'podcasts', library: { type: 'podcasts' }, row: { accessLevel: 'viewer' } });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '5' }))).resolves.toBe(true);
  });

  it('throws BadRequestException when libraryId is missing', async () => {
    const { guard } = makeGuard({ required: 'viewer' });
    await expect(guard.canActivate(makeContext(makeUser(), {}))).rejects.toThrow(BadRequestException);
  });

  it('accepts route param id as library id fallback', async () => {
    const { guard, findFirst } = makeGuard({
      required: 'viewer',
      row: { accessLevel: 'viewer' },
    });
    await expect(guard.canActivate(makeContext(makeUser(), { id: '12' }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalled();
  });

  it('accepts a body libraryId for type-only guards', async () => {
    const { guard, findLibrary } = makeGuard({ requiredType: 'books', library: { type: 'books' } });

    await expect(guard.canActivate(makeContext(makeUser(), {}, { libraryId: 12 }))).resolves.toBe(true);
    expect(findLibrary).toHaveBeenCalled();
  });

  it('allows an omitted libraryId for optional type-only guards', async () => {
    const { guard, findLibrary } = makeGuard({ requiredType: 'books', optionalType: true });

    await expect(guard.canActivate(makeContext(makeUser()))).resolves.toBe(true);
    expect(findLibrary).not.toHaveBeenCalled();
  });

  it('rejects partially numeric library ids', async () => {
    const { guard } = makeGuard({ requiredType: 'books' });

    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '12x' }))).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when no access row exists', async () => {
    const { guard } = makeGuard({ required: 'viewer', row: undefined });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '5' }))).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when access level is insufficient', async () => {
    const { guard } = makeGuard({
      required: 'owner',
      row: { accessLevel: 'editor' },
    });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '5' }))).rejects.toThrow(ForbiddenException);
  });

  it('allows when access level satisfies the requirement', async () => {
    const { guard } = makeGuard({
      required: 'editor',
      row: { accessLevel: 'owner' },
    });
    await expect(guard.canActivate(makeContext(makeUser(), { libraryId: '5' }))).resolves.toBe(true);
  });
});
