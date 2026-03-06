import type { RequestUser } from '../types/request-user';

import { PermissionService } from './permission.service';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'jdoe',
    name: 'Jane Doe',
    email: 'jdoe@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    roles: [
      {
        id: 1,
        name: 'Reader',
        description: null,
        isSuperuser: false,
        isSystem: true,
        permissions: [{ id: 1, name: 'read_books' }],
      },
    ],
    ...overrides,
  };
}

describe('PermissionService', () => {
  const service = new PermissionService();

  it('returns true for any permission when user has a superuser role', () => {
    const user = makeUser({
      roles: [{ id: 9, name: 'Admin', description: null, isSuperuser: true, isSystem: true, permissions: [] }],
    });

    expect(service.userHas(user, 'non_existent_permission')).toBe(true);
  });

  it('returns true when permission exists across multiple roles', () => {
    const user = makeUser({
      roles: [
        { id: 1, name: 'Reader', description: null, isSuperuser: false, isSystem: true, permissions: [{ id: 1, name: 'read_books' }] },
        { id: 2, name: 'Uploader', description: null, isSuperuser: false, isSystem: false, permissions: [{ id: 2, name: 'upload_books' }] },
      ],
    });

    expect(service.userHas(user, 'upload_books')).toBe(true);
  });

  it('returns false when permission does not exist', () => {
    const user = makeUser();

    expect(service.userHas(user, 'manage_users')).toBe(false);
  });

  it('handles malformed role permission lists without throwing', () => {
    const malformedUser = makeUser({
      roles: [
        {
          id: 1,
          name: 'BrokenRole',
          description: null,
          isSuperuser: false,
          isSystem: false,
          permissions: undefined as unknown as RequestUser['roles'][number]['permissions'],
        },
        {
          id: 2,
          name: 'ValidRole',
          description: null,
          isSuperuser: false,
          isSystem: false,
          permissions: [{ id: 10, name: 'read_books' }],
        },
      ],
    });

    expect(() => service.userHas(malformedUser, 'read_books')).not.toThrow();
    expect(service.userHas(malformedUser, 'read_books')).toBe(true);
  });

  it('returns false instead of throwing when roles are missing from a malformed runtime user payload', () => {
    const malformedUser = { ...makeUser(), roles: undefined } as unknown as RequestUser;

    expect(() => service.userHas(malformedUser, 'read_books')).not.toThrow();
    expect(service.userHas(malformedUser, 'read_books')).toBe(false);
  });
});
