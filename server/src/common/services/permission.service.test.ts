import { Permission } from '@bookorbit/types';
import type { RequestUser } from '../types/request-user';

import { PermissionService } from './permission.service';

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
    permissions: [Permission.LibraryDownload],
    ...overrides,
  };
}

describe('PermissionService', () => {
  const service = new PermissionService();

  it('returns true for any permission when user is superuser', () => {
    const user = makeUser({ isSuperuser: true, permissions: [] });

    expect(service.userHas(user, Permission.ManageUsers)).toBe(true);
    expect(service.userHasExplicit(user, Permission.ManageUsers)).toBe(false);
  });

  it('returns true when user has the specific permission', () => {
    const user = makeUser({
      permissions: [Permission.LibraryDownload, Permission.KoboSync],
    });

    expect(service.userHas(user, Permission.KoboSync)).toBe(true);
    expect(service.userHasExplicit(user, Permission.KoboSync)).toBe(true);
  });

  it('returns false when permission does not exist', () => {
    const user = makeUser({ permissions: [Permission.LibraryDownload] });

    expect(service.userHas(user, Permission.ManageUsers)).toBe(false);
  });

  it('returns false instead of throwing when permissions are missing from a malformed runtime user payload', () => {
    const malformedUser = { ...makeUser(), permissions: undefined } as unknown as RequestUser;

    expect(() => service.userHas(malformedUser, Permission.LibraryDownload)).not.toThrow();
    expect(service.userHas(malformedUser, Permission.LibraryDownload)).toBe(false);
    expect(() => service.userHasExplicit(malformedUser, Permission.LibraryDownload)).not.toThrow();
    expect(service.userHasExplicit(malformedUser, Permission.LibraryDownload)).toBe(false);
  });
});
