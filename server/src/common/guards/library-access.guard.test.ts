import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';

import type { RequestUser } from '../types/request-user';
import { LibraryAccessGuard } from './library-access.guard';

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

function makeContext(user: RequestUser, params: Record<string, string> = {}): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(
  overrides: {
    required?: 'viewer' | 'editor' | 'owner' | undefined;
    row?: { accessLevel: 'viewer' | 'editor' | 'owner' } | undefined;
  } = {},
) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(overrides.required),
  };
  const findFirst = vi.fn().mockResolvedValue(overrides.row);
  const db = {
    query: {
      userLibraryAccess: {
        findFirst,
      },
    },
  };

  const guard = new LibraryAccessGuard(reflector as never, db as never);
  return { guard, findFirst };
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
