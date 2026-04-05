import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Permission } from '@projectx/types';

import { createCoverToken, OpdsAuthGuard } from '../opds-auth.guard';
import type { OpdsRequestUser } from '../opds-auth.guard';
import type { OpdsUserService } from '../opds-user.service';
import type { UserService } from '../../user/user.service';
import type { PermissionService } from '../../../common/services/permission.service';

const TEST_SECRET = 'test-jwt-secret';

function mockContext(authHeader?: string, tokenParam?: string, url = '/api/v1/opds/libraries') {
  const query: Record<string, string> = {};
  if (tokenParam) query.t = tokenParam;
  const request: Record<string, unknown> = { headers: { authorization: authHeader }, query, url };
  const reply = { header: vi.fn() };
  return {
    request,
    reply,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => reply,
      }),
    } as unknown as ExecutionContext,
  };
}

const OPDS_USER = {
  id: 10,
  userId: 1,
  username: 'reader',
  passwordHash: '$2a',
  sortOrder: 'recent' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const PARENT_USER = { id: 1, username: 'admin', name: 'Admin', active: true };
const FULL_USER = {
  id: 1,
  username: 'admin',
  name: 'Admin',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [Permission.OpdsAccess],
};

function makeGuard(overrides: { validateResult?: unknown; fullUser?: unknown; userHas?: boolean } = {}) {
  const opdsUserService = {
    validateCredentials: vi
      .fn()
      .mockResolvedValue(overrides.validateResult !== undefined ? overrides.validateResult : { opdsUser: OPDS_USER, parentUser: PARENT_USER }),
  };
  const userService = {
    findByIdWithPermissions: vi.fn().mockResolvedValue(overrides.fullUser !== undefined ? overrides.fullUser : FULL_USER),
  };
  const permissionService = {
    userHas: vi.fn().mockReturnValue(overrides.userHas !== undefined ? overrides.userHas : true),
  };
  const configService = { get: vi.fn().mockReturnValue(TEST_SECRET) };
  return new OpdsAuthGuard(
    opdsUserService as unknown as OpdsUserService,
    userService as unknown as UserService,
    permissionService as unknown as PermissionService,
    configService as unknown as ConfigService,
  );
}

function basicHeader(user: string, pass: string) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('OpdsAuthGuard', () => {
  it('returns 401 with WWW-Authenticate when no Authorization header', async () => {
    const guard = makeGuard();
    const { context, reply } = mockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="projectx OPDS"');
  });

  it('returns 401 when Authorization is not Basic', async () => {
    const guard = makeGuard();
    const { context, reply } = mockContext('Bearer xyz');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="projectx OPDS"');
  });

  it('returns 401 when decoded credentials have no colon', async () => {
    const guard = makeGuard();
    const header = `Basic ${Buffer.from('nocolon').toString('base64')}`;
    const { context, reply } = mockContext(header);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="projectx OPDS"');
  });

  it('returns 401 when credentials are invalid', async () => {
    const guard = makeGuard({ validateResult: null });
    const { context, reply } = mockContext(basicHeader('bad', 'creds'));
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="projectx OPDS"');
  });

  it('returns 401 when parent user is inactive', async () => {
    const guard = makeGuard({ validateResult: { opdsUser: OPDS_USER, parentUser: { ...PARENT_USER, active: false } } });
    const { context } = mockContext(basicHeader('reader', 'pass'));
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('returns 401 when parent user not found via findByIdWithPermissions', async () => {
    const guard = makeGuard({ fullUser: null });
    const { context } = mockContext(basicHeader('reader', 'pass'));
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('returns 403 when parent user lacks opds_access permission', async () => {
    const guard = makeGuard({ userHas: false });
    const { context } = mockContext(basicHeader('reader', 'pass'));
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects token auth on non-image routes with Basic challenge', async () => {
    const guard = makeGuard();
    const token = createCoverToken(1, TEST_SECRET);
    const { context, reply } = mockContext(undefined, token, '/api/v1/opds/libraries');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="projectx OPDS"');
  });

  it('accepts token auth on image routes', async () => {
    const guard = makeGuard();
    const token = createCoverToken(1, TEST_SECRET);
    const { context, request } = mockContext(undefined, token, '/api/v1/opds/42/cover');
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect((request.opdsUser as OpdsRequestUser).userId).toBe(1);
  });

  it('rejects a same-length tampered cover token', async () => {
    const guard = makeGuard();
    const token = createCoverToken(1, TEST_SECRET);
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    const { context } = mockContext(undefined, tamperedToken, '/api/v1/opds/42/cover');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches opdsUser to request on success', async () => {
    const guard = makeGuard();
    const { context, request } = mockContext(basicHeader('reader', 'pass'));
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    const opdsUser = request.opdsUser as OpdsRequestUser;
    expect(opdsUser.opdsUserId).toBe(10);
    expect(opdsUser.userId).toBe(1);
    expect(opdsUser.username).toBe('reader');
    expect(opdsUser.sortOrder).toBe('recent');
    expect(opdsUser.isSuperuser).toBe(false);
    expect(typeof opdsUser.coverToken).toBe('string');
    expect(opdsUser.coverToken).toMatch(/^1\./);
  });

  it('handles password containing colons', async () => {
    const guard = makeGuard();
    const { context } = mockContext(basicHeader('reader', 'pa:ss:word'));
    await guard.canActivate(context);
    const svc = (guard as unknown as { opdsUserService: { validateCredentials: vi.Mock } }).opdsUserService;
    expect(svc.validateCredentials).toHaveBeenCalledWith('reader', 'pa:ss:word');
  });
});
