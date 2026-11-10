import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, Permission, type CreateApiKeyRequest } from '@bookorbit/types';

import { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import type { ApiKeyRecord } from './api-key.repository';
import { ApiKeyService } from './api-key.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 5,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.ApiKeys, Permission.LibraryDownload],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: 40,
    userId: 5,
    createdBy: null,
    createdByUsername: null,
    name: 'script',
    tokenHint: 'wxyz',
    audience: 'api',
    access: 'read',
    permissions: [],
    admin: false,
    libraryLimited: false,
    libraryIds: [],
    expiresAt: new Date(Date.now() + 90 * DAY_MS),
    lastUsedAt: null,
    lastUsedIp: null,
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

function setup(owner: RequestUser | null = user(), settings = { enabled: true, maxLifetimeDays: null as number | null }) {
  const repo = {
    insert: vi.fn().mockResolvedValue({ status: 'created', id: 40 }),
    findOwned: vi.fn().mockResolvedValue(record()),
    listByUser: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue(true),
    revoke: vi.fn().mockResolvedValue(true),
    revokeAllByUser: vi.fn().mockResolvedValue(3),
    pruneBatch: vi.fn().mockResolvedValue(0),
  };
  const appSettings = { getApiKeySettings: vi.fn().mockResolvedValue(settings) };
  const authService = { findActingUser: vi.fn().mockResolvedValue(owner) };
  const libraryScope = { visibleIds: vi.fn().mockResolvedValue([1, 2]) };
  const users = { findByIdWithPermissions: vi.fn().mockResolvedValue(owner) };
  const service = new ApiKeyService(
    repo as never,
    appSettings as never,
    authService as never,
    libraryScope as never,
    new PermissionService(),
    users as never,
  );
  return { service, repo, libraryScope, authService, users };
}

async function createWith(
  input: Partial<CreateApiKeyRequest>,
  owner?: RequestUser | null,
  settings?: { enabled: boolean; maxLifetimeDays: number | null },
) {
  const { service, repo } = setup(owner === undefined ? user() : owner, settings);
  const result = await service.create(5, { name: ' my script ', ...input });
  return { result, repo, row: repo.insert.mock.calls[0]?.[0], libraryIds: repo.insert.mock.calls[0]?.[1] };
}

describe('ApiKeyService.create', () => {
  it('defaults to a read-only key with no permissions, every library and a 90 day life', async () => {
    const { result, row, libraryIds, repo } = await createWith({});
    expect(row).toMatchObject({ userId: 5, createdBy: null, name: 'my script', access: 'read', permissions: [], admin: false, audience: 'api' });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / DAY_MS)).toBe(90);
    expect(libraryIds).toBeNull();
    expect(repo.insert.mock.calls[0][2]).toBe(25);
    expect(result.token).toMatch(/^bok_/);
    expect(result.token.endsWith(row.tokenHint)).toBe(true);
    expect(JSON.stringify(result.key)).not.toContain(result.token);
  });

  it('stores a key that never expires when no limit is set', async () => {
    const { row } = await createWith({ expiresInDays: null });
    expect(row.expiresAt).toBeNull();
  });

  it('refuses an owner without the API keys permission', async () => {
    await expect(createWith({}, user({ permissions: [Permission.LibraryDownload] }))).rejects.toMatchObject({
      response: { errorCode: 'API_KEY_OWNER_NOT_PERMITTED' },
    });
  });

  it('refuses an unknown or inactive owner with the code the form can explain', async () => {
    await expect(createWith({}, null)).rejects.toMatchObject({ response: { errorCode: 'API_KEY_OWNER_NOT_PERMITTED' } });
  });

  it('refuses while keys are turned off', async () => {
    await expect(createWith({}, user(), { enabled: false, maxLifetimeDays: null })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses permissions the owner does not hold, and ones a key can never be granted', async () => {
    await expect(createWith({ permissions: [Permission.ManageUsers] })).rejects.toMatchObject({
      response: { errorCode: 'API_KEY_SCOPE_EXCEEDS_OWNER' },
    });
    await expect(createWith({ permissions: [Permission.DemoRestricted] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(createWith({ permissions: [Permission.ApiKeys] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a superuser grant any permission and administrator access', async () => {
    const { row } = await createWith(
      { permissions: [Permission.ManageUsers], admin: true, access: 'write' },
      user({ isSuperuser: true, permissions: [] }),
    );
    expect(row).toMatchObject({ permissions: [Permission.ManageUsers], admin: true, access: 'write' });
  });

  it('refuses administrator access for a non-superuser and with libraries', async () => {
    await expect(createWith({ admin: true })).rejects.toMatchObject({ response: { errorCode: 'API_KEY_SCOPE_EXCEEDS_OWNER' } });
    await expect(createWith({ admin: true, libraryIds: [1] }, user({ isSuperuser: true }))).rejects.toMatchObject({
      response: { errorCode: 'API_KEY_ADMIN_WITH_LIBRARIES' },
    });
  });

  it('limits a key to libraries the owner can see and refuses others', async () => {
    const { libraryIds } = await createWith({ libraryIds: [2, 2, 1] });
    expect(libraryIds).toEqual([2, 1]);
    await expect(createWith({ libraryIds: [3] })).rejects.toMatchObject({ response: { errorCode: 'API_KEY_SCOPE_EXCEEDS_OWNER' } });
    await expect(createWith({ libraryIds: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('holds every key to the longest lifetime an administrator allows', async () => {
    const capped = { enabled: true, maxLifetimeDays: 60 };
    await expect(createWith({ expiresInDays: null }, user(), capped)).rejects.toMatchObject({
      response: { errorCode: 'API_KEY_EXPIRY_EXCEEDS_CAP', errorMeta: { cap: 60 } },
    });
    await expect(createWith({ expiresInDays: 90 }, user(), capped)).rejects.toBeInstanceOf(BadRequestException);
    const { row } = await createWith({}, user(), capped);
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / DAY_MS)).toBe(60);
  });

  it('reports the active key limit with a stable code', async () => {
    const { service, repo } = setup();
    repo.insert.mockResolvedValue({ status: 'limit_reached' });
    await expect(service.create(5, { name: 'one too many' })).rejects.toMatchObject({ response: { errorCode: 'API_KEY_LIMIT_REACHED' } });
  });

  it('records the administrator who issued a key for someone else', async () => {
    const { service, repo } = setup();
    await service.create(5, { name: 'issued' }, user({ id: 1, isSuperuser: true }));
    expect(repo.insert.mock.calls[0][0]).toMatchObject({ userId: 5, createdBy: 1 });
  });
});

describe('ApiKeyService management', () => {
  it('regenerates by replacing the key with a copy that has a new secret', async () => {
    const { service, repo } = setup();
    repo.findOwned.mockResolvedValue(
      record({ id: 40, access: 'write', permissions: [Permission.LibraryDownload], libraryLimited: true, libraryIds: [2] }),
    );
    const result = await service.regenerate(5, 40);
    const [row, libraryIds, , replacesId] = repo.insert.mock.calls[0];
    expect(replacesId).toBe(40);
    expect(row).toMatchObject({ name: 'script', access: 'write', permissions: [Permission.LibraryDownload] });
    expect(libraryIds).toEqual([2]);
    expect(result.token).toMatch(/^bok_/);
  });

  it('clamps a regenerated key to the current lifetime limit', async () => {
    const { service, repo } = setup(user(), { enabled: true, maxLifetimeDays: 30 });
    repo.findOwned.mockResolvedValue(record({ expiresAt: null }));
    await service.regenerate(5, 40);
    expect(Math.round((repo.insert.mock.calls[0][0].expiresAt.getTime() - Date.now()) / DAY_MS)).toBe(30);
  });

  it('refuses to rename or regenerate a revoked key, and hides keys of other users', async () => {
    const { service, repo } = setup();
    repo.findOwned.mockResolvedValueOnce(record({ revokedAt: new Date() }));
    await expect(service.rename(5, 40, 'new')).rejects.toBeInstanceOf(ConflictException);
    repo.findOwned.mockResolvedValueOnce(null);
    await expect(service.regenerate(5, 41)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokes idempotently', async () => {
    const { service, repo } = setup();
    repo.findOwned.mockResolvedValue(record({ revokedAt: new Date() }));
    await service.revoke(5, 40);
    expect(repo.revoke).not.toHaveBeenCalled();
  });

  it('keeps a manager who is not a superuser away from a superuser keys', async () => {
    const { service } = setup(user({ id: 1, isSuperuser: true }));
    const manager = user({ id: 2, permissions: [Permission.ManageUsers] });
    await expect(service.assertCanManageKeysOf(manager, 1)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertCanManageKeysOf(user({ id: 3, isSuperuser: true }), 1)).resolves.toMatchObject({ id: 1 });
  });

  it('lets an administrator reach a suspended person keys, but issue none to them', async () => {
    const { service, authService, users } = setup(user({ id: 4, active: false, permissions: [Permission.ApiKeys] }));
    authService.findActingUser.mockResolvedValue(null);
    const admin = user({ id: 3, isSuperuser: true });

    await expect(service.assertCanManageKeysOf(admin, 4)).resolves.toMatchObject({ id: 4 });
    expect(users.findByIdWithPermissions).toHaveBeenCalledWith(4);
    await expect(service.create(4, { name: 'For a suspended person' }, admin)).rejects.toMatchObject({
      response: { errorCode: 'API_KEY_OWNER_NOT_PERMITTED' },
    });
  });

  it('prunes in bounded batches until a batch comes back short', async () => {
    const { service, repo } = setup();
    repo.pruneBatch.mockResolvedValueOnce(500).mockResolvedValueOnce(500).mockResolvedValueOnce(12);
    await expect(service.pruneStale()).resolves.toBe(1012);
    expect(repo.pruneBatch).toHaveBeenCalledTimes(3);
  });
});
