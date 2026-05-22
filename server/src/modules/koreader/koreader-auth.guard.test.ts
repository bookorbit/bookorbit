vi.mock('bcryptjs', () => ({ compare: vi.fn() }));
vi.mock('crypto', () => ({ createHash: vi.fn() }));

import { ExecutionContext, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Permission } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

const mockCompare = vi.mocked(compare);
const mockCreateHash = vi.mocked(createHash);

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 42,
    username: 'alice',
    name: 'Alice Reader',
    email: 'alice@example.com',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.KoreaderSync],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeKoreaderUser(
  overrides: Partial<{
    userId: number;
    username: string;
    passwordHash: string;
    passwordMd5: string | null;
    syncEnabled: boolean;
  }> = {},
) {
  return {
    userId: 42,
    username: 'alice',
    passwordHash: 'bcrypt-hash',
    passwordMd5: 'calculated-md5',
    syncEnabled: true,
    ...overrides,
  };
}

describe('KoreaderAuthGuard', () => {
  const mockRepo = {
    findKoreaderUserByUsername: vi.fn(),
  };

  const mockUserService = {
    findByIdWithPermissions: vi.fn(),
  };

  const mockPermissionService = {
    userHas: vi.fn(),
  };

  const mockRequest: {
    headers: Record<string, string>;
    user?: RequestUser;
    koreaderUserId?: number;
  } = {
    headers: {} as Record<string, string>,
  };

  const mockContext = {
    switchToHttp: () => ({ getRequest: () => mockRequest }),
  };

  let guard: KoreaderAuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest.headers = {};
    delete mockRequest.user;
    delete mockRequest.koreaderUserId;

    mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUser());
    mockUserService.findByIdWithPermissions.mockResolvedValue(makeUser());
    mockPermissionService.userHas.mockReturnValue(true);
    mockCompare.mockResolvedValue(false);

    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('calculated-md5'),
    };

    mockCreateHash.mockReturnValue(mockHash as unknown as ReturnType<typeof createHash>);

    guard = new KoreaderAuthGuard(mockRepo as unknown as KoreaderRepository, mockUserService as never, mockPermissionService as never);
  });

  async function expectGuardToReject(
    expectedType: typeof UnauthorizedException | typeof ForbiddenException,
    expectedStatus: number,
    expectedMessage: string,
  ) {
    try {
      await guard.canActivate(mockContext as ExecutionContext);
      throw new Error('Expected guard to reject the request');
    } catch (error) {
      expect(error).toBeInstanceOf(expectedType);
      expect((error as UnauthorizedException | ForbiddenException).getStatus()).toBe(expectedStatus);
      expect((error as Error).message).toBe(expectedMessage);
    }
  }

  it('returns 401 when x-auth-user is missing', async () => {
    mockRequest.headers['x-auth-key'] = 'secret';

    await expectGuardToReject(UnauthorizedException, 401, 'Missing KOReader credentials');
    expect(mockRepo.findKoreaderUserByUsername).not.toHaveBeenCalled();
  });

  it('returns 401 when x-auth-key is missing', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';

    await expectGuardToReject(UnauthorizedException, 401, 'Missing KOReader credentials');
    expect(mockRepo.findKoreaderUserByUsername).not.toHaveBeenCalled();
  });

  it('returns 401 when headers are empty strings', async () => {
    mockRequest.headers['x-auth-user'] = '';
    mockRequest.headers['x-auth-key'] = '';

    await expectGuardToReject(UnauthorizedException, 401, 'Missing KOReader credentials');
    expect(mockRepo.findKoreaderUserByUsername).not.toHaveBeenCalled();
  });

  it('returns 401 when the KOReader user does not exist', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockRepo.findKoreaderUserByUsername.mockResolvedValueOnce(null);

    await expectGuardToReject(UnauthorizedException, 401, 'Invalid credentials');
    expect(mockUserService.findByIdWithPermissions).not.toHaveBeenCalled();
  });

  it('returns 403 when sync is disabled for the KOReader user', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockRepo.findKoreaderUserByUsername.mockResolvedValueOnce(makeKoreaderUser({ syncEnabled: false }));

    await expectGuardToReject(ForbiddenException, 403, 'Sync is disabled');
    expect(mockUserService.findByIdWithPermissions).not.toHaveBeenCalled();
  });

  it('passes bcrypt authentication and sets koreaderUserId', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(true);

    await expect(guard.canActivate(mockContext as ExecutionContext)).resolves.toBe(true);

    expect(mockCompare).toHaveBeenCalledWith('secret', 'bcrypt-hash');
    expect(mockRequest.koreaderUserId).toBe(42);
    expect(mockRequest.user).toEqual(expect.objectContaining({ id: 42, username: 'alice' }));
    expect(mockCreateHash).not.toHaveBeenCalled();
  });

  it('passes MD5 authentication when bcrypt comparison fails', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(false);

    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('calculated-md5'),
    };
    mockCreateHash.mockReturnValueOnce(mockHash as unknown as ReturnType<typeof createHash>);

    await expect(guard.canActivate(mockContext as ExecutionContext)).resolves.toBe(true);

    expect(mockCreateHash).toHaveBeenCalledWith('md5');
    expect(mockHash.update).toHaveBeenCalledWith('secret');
    expect(mockRequest.koreaderUserId).toBe(42);
  });

  it('returns 401 when the password is wrong', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'wrong-secret';

    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('different-md5'),
    };
    mockCreateHash.mockReturnValueOnce(mockHash as unknown as ReturnType<typeof createHash>);

    await expectGuardToReject(UnauthorizedException, 401, 'Invalid credentials');
    expect(mockUserService.findByIdWithPermissions).not.toHaveBeenCalled();
  });

  it('sets koreaderUserId on the request after successful authentication', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockRepo.findKoreaderUserByUsername.mockResolvedValueOnce(makeKoreaderUser({ userId: 99 }));
    mockUserService.findByIdWithPermissions.mockResolvedValueOnce(makeUser({ id: 99, username: 'alice' }));
    mockCompare.mockResolvedValueOnce(true);

    await guard.canActivate(mockContext as ExecutionContext);

    expect(mockRequest.koreaderUserId).toBe(99);
    expect(mockRequest.user).toEqual(expect.objectContaining({ id: 99, username: 'alice' }));
  });

  it('returns 401 when user account is not found after credential validation', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(true);
    mockUserService.findByIdWithPermissions.mockResolvedValueOnce(null);

    await expectGuardToReject(UnauthorizedException, 401, 'Account not found or disabled');
  });

  it('returns 401 when user account is disabled', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(true);
    mockUserService.findByIdWithPermissions.mockResolvedValueOnce(makeUser({ active: false }));

    await expectGuardToReject(UnauthorizedException, 401, 'Account not found or disabled');
  });

  it('returns 401 when user lacks koreader_sync permission', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(true);
    mockPermissionService.userHas.mockReturnValueOnce(false);

    await expectGuardToReject(UnauthorizedException, 401, 'KOReader sync permission revoked');
  });

  it('passes when user is superuser (bypasses permission check)', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(true);
    mockUserService.findByIdWithPermissions.mockResolvedValueOnce(makeUser({ isSuperuser: true, permissions: [] }));
    mockPermissionService.userHas.mockReturnValueOnce(true);

    await expect(guard.canActivate(mockContext as ExecutionContext)).resolves.toBe(true);
    expect(mockPermissionService.userHas).toHaveBeenCalledWith(expect.objectContaining({ isSuperuser: true }), Permission.KoreaderSync);
  });

  it('passes when incoming key is exactly 32 hex chars matching md5 hash (pre-hashed key)', async () => {
    const md5Key = 'abcdef0123456789abcdef0123456789';
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = md5Key;
    mockCompare.mockResolvedValueOnce(false);
    mockRepo.findKoreaderUserByUsername.mockResolvedValueOnce(makeKoreaderUser({ passwordMd5: md5Key }));

    await expect(guard.canActivate(mockContext as ExecutionContext)).resolves.toBe(true);
    expect(mockCreateHash).not.toHaveBeenCalled();
  });

  it('returns 401 when md5 hash matches no password and no md5 stored', async () => {
    mockRequest.headers['x-auth-user'] = 'alice';
    mockRequest.headers['x-auth-key'] = 'secret';
    mockCompare.mockResolvedValueOnce(false);
    mockRepo.findKoreaderUserByUsername.mockResolvedValueOnce(makeKoreaderUser({ passwordMd5: null }));

    await expectGuardToReject(UnauthorizedException, 401, 'Invalid credentials');
  });
});
