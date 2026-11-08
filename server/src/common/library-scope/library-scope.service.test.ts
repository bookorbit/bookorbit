import { ForbiddenException } from '@nestjs/common';
import type { AccessLevel } from '@bookorbit/types';

import type { ApiKeyCredential } from '../types/request-user';
import { LibraryScopeService, type LibraryScopeSubject } from './library-scope.service';

const ALL_LIBRARIES = [1, 2, 3];
const GRANTS: { id: number; accessLevel: AccessLevel }[] = [
  { id: 1, accessLevel: 'viewer' },
  { id: 2, accessLevel: 'editor' },
];

function makeService() {
  const repo = {
    findAllIds: vi.fn(() => Promise.resolve([...ALL_LIBRARIES])),
    findExistingIds: vi.fn((ids: readonly number[]) => Promise.resolve(ALL_LIBRARIES.filter((id) => ids.includes(id)))),
    findGrantedLevels: vi.fn((_userId: number, levels?: readonly AccessLevel[]) =>
      Promise.resolve(GRANTS.filter((grant) => !levels || levels.includes(grant.accessLevel))),
    ),
    findGrantedLevel: vi.fn((_userId: number, libraryId: number) =>
      Promise.resolve(GRANTS.find((grant) => grant.id === libraryId)?.accessLevel ?? null),
    ),
    findIsSuperuser: vi.fn(() => Promise.resolve(false)),
  };
  return { service: new LibraryScopeService(repo as never), repo };
}

function key(overrides: Partial<ApiKeyCredential> = {}): ApiKeyCredential {
  return { kind: 'api_key', keyId: 9, keyName: 'script', audience: 'api', access: 'write', libraryIds: null, ownerIsSuperuser: false, ...overrides };
}

const regular: LibraryScopeSubject = { id: 5, isSuperuser: false };
const superuser: LibraryScopeSubject = { id: 1, isSuperuser: true };

describe('LibraryScopeService', () => {
  it('lets a superuser see every library without reading grants', async () => {
    const { service, repo } = makeService();
    expect(service.seesAllLibraries(superuser)).toBe(true);
    expect(await service.visibleIdsOrAll(superuser)).toBeNull();
    expect(await service.visibleIds(superuser)).toEqual(ALL_LIBRARIES);
    expect(await service.levelFor(superuser, 3)).toBe('owner');
    expect(repo.findGrantedLevel).not.toHaveBeenCalled();
  });

  it('limits a regular user to their grants', async () => {
    const { service } = makeService();
    expect(await service.visibleIds(regular)).toEqual([1, 2]);
    expect(await service.editableIds(regular)).toEqual([2]);
    expect(await service.levelFor(regular, 3)).toBeNull();
    await expect(service.assertVisible(regular, 3)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertLevel(regular, 1, 'editor')).rejects.toThrow('Insufficient library access level');
    await expect(service.assertLevel(regular, 2, 'editor')).resolves.toBeUndefined();
  });

  it('keeps every library for a superuser key without administrator access', async () => {
    const { service } = makeService();
    const user = { id: 1, isSuperuser: false, credential: key({ ownerIsSuperuser: true }) };
    expect(service.seesAllLibraries(user)).toBe(true);
    expect(await service.visibleIds(user)).toEqual(ALL_LIBRARIES);
    expect(await service.levelFor(user, 3)).toBe('owner');
  });

  it('narrows a library-limited key to its libraries', async () => {
    const { service } = makeService();
    const user = { ...regular, credential: key({ libraryIds: [2, 3] }) };
    expect(service.seesAllLibraries(user)).toBe(false);
    expect(await service.visibleIds(user)).toEqual([2]);
    expect(await service.levelFor(user, 1)).toBeNull();
    expect(await service.levelFor(user, 3)).toBeNull();
    expect(await service.levelFor(user, 2)).toBe('editor');
    expect(await service.filterVisible(user, [3, 2, 1])).toEqual([2]);
  });

  it('narrows a superuser owner to the key libraries that still exist', async () => {
    const { service } = makeService();
    const user = { id: 1, isSuperuser: false, credential: key({ ownerIsSuperuser: true, libraryIds: [3, 99] }) };
    expect(await service.visibleIdsOrAll(user)).toEqual([3]);
    expect(await service.visibleLevels(user)).toEqual([{ id: 3, accessLevel: 'owner' }]);
  });

  it('sees nothing once every library a key was limited to is gone', async () => {
    const { service } = makeService();
    const user = { ...regular, credential: key({ libraryIds: [] }) };
    expect(await service.visibleIdsOrAll(user)).toEqual([]);
    expect(await service.canSee(user, 1)).toBe(false);
  });

  it('caps a read-only key at viewer', async () => {
    const { service } = makeService();
    const user = { ...regular, credential: key({ access: 'read' }) };
    expect(await service.levelFor(user, 2)).toBe('viewer');
    expect(await service.editableIds(user)).toEqual([]);
    await expect(service.assertLevel(user, 2, 'editor')).rejects.toThrow('Insufficient library access level');
    expect(await service.visibleLevels(user)).toEqual([
      { id: 1, accessLevel: 'viewer' },
      { id: 2, accessLevel: 'viewer' },
    ]);
  });

  it('looks up the owner when only a user id is known', async () => {
    const { service, repo } = makeService();
    repo.findIsSuperuser.mockResolvedValueOnce(true);
    expect(await service.visibleIdsOrAllForUserId(1)).toBeNull();
    expect(await service.visibleIdsOrAllForUserId(5)).toEqual([1, 2]);
  });
});
