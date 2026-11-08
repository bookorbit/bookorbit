import { HttpException, UnauthorizedException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, Permission } from '@bookorbit/types';

import { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import { ApiKeyFailureLimiter } from './api-key-failure-limiter';
import { generateApiKeyToken, hashApiKeyToken } from './api-key-token';
import { ApiKeyAuthenticator, narrowToApiKey } from './api-key.authenticator';
import type { ApiKeyRecord } from './api-key.repository';

function owner(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 5,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: true,
    tokenVersion: 4,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.ApiKeys, Permission.LibraryDownload, Permission.LibraryEditMetadata],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function key(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: 9,
    userId: 5,
    createdBy: null,
    createdByUsername: null,
    name: 'sync script',
    tokenHint: 'abcd',
    audience: 'api',
    access: 'write',
    permissions: [Permission.LibraryDownload],
    admin: false,
    libraryLimited: false,
    libraryIds: [],
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

function setup(record: ApiKeyRecord | null = key(), user: RequestUser | null = owner(), enabled = true) {
  const repo = { findByHash: vi.fn().mockResolvedValue(record), touchLastUsed: vi.fn().mockResolvedValue(undefined) };
  const appSettings = { getApiKeySettings: vi.fn().mockResolvedValue({ enabled, maxLifetimeDays: null }) };
  const authService = { findActingUser: vi.fn().mockResolvedValue(user) };
  const limiter = new ApiKeyFailureLimiter();
  const authenticator = new ApiKeyAuthenticator(repo as never, appSettings as never, authService as never, new PermissionService(), limiter);
  return { authenticator, repo, authService, limiter };
}

describe('narrowToApiKey', () => {
  it('keeps only granted permissions the owner still holds, and every restriction the owner has', () => {
    const narrowed = narrowToApiKey(
      owner({ permissions: [Permission.ApiKeys, Permission.LibraryDownload, Permission.DemoRestricted] }),
      key({ permissions: [Permission.LibraryDownload, Permission.ManageUsers, 'retired_permission'] }),
    );
    expect(narrowed.permissions.sort()).toEqual([Permission.DemoRestricted, Permission.LibraryDownload].sort());
    expect(narrowed.isDefaultPassword).toBe(false);
    expect(narrowed.authenticationMethod).toBe('api_key');
    expect(narrowed.credential).toEqual({
      kind: 'api_key',
      keyId: 9,
      keyName: 'sync script',
      audience: 'api',
      access: 'write',
      libraryIds: null,
      ownerIsSuperuser: false,
    });
  });

  it('gives a superuser key administrator power only with the administrator flag', () => {
    const superuser = owner({ isSuperuser: true, permissions: [] });
    const scoped = narrowToApiKey(superuser, key({ permissions: [Permission.ManageUsers] }));
    expect(scoped.isSuperuser).toBe(false);
    expect(scoped.permissions).toEqual([Permission.ManageUsers]);
    expect(scoped.credential).toMatchObject({ ownerIsSuperuser: true });

    expect(narrowToApiKey(superuser, key({ admin: true })).isSuperuser).toBe(true);
    expect(narrowToApiKey(owner(), key({ admin: true })).isSuperuser).toBe(false);
  });

  it('carries the key libraries only when the key is limited, even once they are all gone', () => {
    expect(narrowToApiKey(owner(), key({ libraryLimited: true, libraryIds: [2] })).credential).toMatchObject({ libraryIds: [2] });
    expect(narrowToApiKey(owner(), key({ libraryLimited: true, libraryIds: [] })).credential).toMatchObject({ libraryIds: [] });
  });
});

describe('ApiKeyAuthenticator', () => {
  const token = generateApiKeyToken();

  it('looks the key up by hash and returns the narrowed owner', async () => {
    const { authenticator, repo } = setup();
    const user = await authenticator.authenticate(token, '10.0.0.1');
    expect(repo.findByHash).toHaveBeenCalledWith(hashApiKeyToken(token));
    expect(repo.touchLastUsed).toHaveBeenCalledWith(9, '10.0.0.1');
    expect(user).toMatchObject({ id: 5, permissions: [Permission.LibraryDownload], credential: { kind: 'api_key', keyId: 9 } });
  });

  it('refuses a malformed key without a query', async () => {
    const { authenticator, repo } = setup();
    const typo = token.slice(0, 10) + (token[10] === 'a' ? 'b' : 'a') + token.slice(11);
    await expect(authenticator.authenticate(typo, null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown key', null, owner()],
    ['a revoked key', key({ revokedAt: new Date() }), owner()],
    ['an expired key', key({ expiresAt: new Date(Date.now() - 1000) }), owner()],
    ['a key for another audience', key({ audience: 'opds' }), owner()],
    ['an inactive or unknown owner', key(), null],
    ['an owner who lost the API keys permission', key(), owner({ permissions: [Permission.LibraryDownload] })],
  ])('refuses %s', async (_label, record, user) => {
    const { authenticator, repo } = setup(record, user);
    await expect(authenticator.authenticate(token, null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.touchLastUsed).not.toHaveBeenCalled();
  });

  it('refuses every key with a stable code while keys are turned off', async () => {
    const { authenticator, repo } = setup(key(), owner(), false);
    await expect(authenticator.authenticate(token, null)).rejects.toMatchObject({ response: { errorCode: 'API_KEYS_DISABLED' } });
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it('lets a superuser own keys without holding the permission explicitly', async () => {
    const { authenticator } = setup(key(), owner({ isSuperuser: true, permissions: [] }));
    await expect(authenticator.authenticate(token, null)).resolves.toMatchObject({ isSuperuser: false });
  });

  it('stops answering an address that keeps presenting bad keys', async () => {
    const { authenticator, repo } = setup(null);
    for (let i = 0; i < 30; i++) await authenticator.authenticate(token, '10.9.9.9').catch(() => undefined);
    repo.findByHash.mockClear();

    await expect(authenticator.authenticate(token, '10.9.9.9')).rejects.toBeInstanceOf(HttpException);
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it('does not fail the request when recording the last use fails', async () => {
    const { authenticator, repo } = setup();
    repo.touchLastUsed.mockRejectedValue(new Error('db down'));
    await expect(authenticator.authenticate(token, null)).resolves.toMatchObject({ id: 5 });
  });
});
