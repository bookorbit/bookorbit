import { Permission } from '@bookorbit/types';
import { WS_UNAUTHORIZED_EVENT } from '../../common/utils/ws-auth.utils';

import type { RequestUser } from '../../common/types/request-user';
import { NotificationGateway } from './notification.gateway';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeGateway() {
  return new NotificationGateway({} as never, {} as never, {} as never, { get: vi.fn().mockReturnValue('http://localhost:5173') } as never);
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    username: 'user',
    name: 'User',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    isSuperuser: false,
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

describe('NotificationGateway', () => {
  it('allows users with notification access', () => {
    const gateway = makeGateway();
    const user = makeUser({ permissions: [Permission.NotificationAccess] });

    expect(() => (gateway as any).assertHasAccess(user)).not.toThrow();
  });

  it('allows superusers without explicit notification_access', () => {
    const gateway = makeGateway();
    const user = makeUser({ isSuperuser: true });

    expect(() => (gateway as any).assertHasAccess(user)).not.toThrow();
  });

  it('denies demo-restricted users even when notification access exists', () => {
    const gateway = makeGateway();
    const user = makeUser({ permissions: [Permission.NotificationAccess, Permission.DemoRestricted] });

    expect(() => (gateway as any).assertHasAccess(user)).toThrow('Demo-restricted account cannot access notifications');
  });

  it('denies demo-restricted superusers even with superuser flag set', () => {
    const gateway = makeGateway();
    const user = makeUser({ isSuperuser: true, permissions: [Permission.DemoRestricted] });

    expect(() => (gateway as any).assertHasAccess(user)).toThrow('Demo-restricted account cannot access notifications');
  });

  it('denies users without notification access', () => {
    const gateway = makeGateway();
    const user = makeUser();

    expect(() => (gateway as any).assertHasAccess(user)).toThrow('Missing permission: notification_access');
  });
});

/** What `JwtService.verify` throws for a token that outlived a sleeping tab. */
function expiredTokenError(): Error {
  const error = new Error('jwt expired');
  error.name = 'TokenExpiredError';
  return error;
}

describe('NotificationGateway handshake rejection', () => {
  function makeConnectingGateway(overrides: { verify?: () => unknown; user?: RequestUser | null } = {}) {
    const jwtService = {
      verify:
        overrides.verify ??
        vi.fn(() => {
          throw expiredTokenError();
        }),
    };
    const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue(overrides.user ?? null) };
    const notificationRepo = { countUnread: vi.fn().mockResolvedValue(0) };
    const config = { get: vi.fn().mockReturnValue('http://localhost:5173') };
    const gateway = new NotificationGateway(jwtService as never, userService as never, notificationRepo as never, config as never);
    const client = { id: 'sock-1', handshake: { auth: { token: 'jwt' } }, data: {}, join: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    return { gateway, client };
  }

  it('invites the client to re-authenticate when the token has expired', async () => {
    const { gateway, client } = makeConnectingGateway();

    await gateway.handleConnection(client as never);

    expect(client.emit).toHaveBeenCalledWith(WS_UNAUTHORIZED_EVENT, { reason: 'invalid_token' });
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes without an invitation when the user simply lacks notification access', async () => {
    const { gateway, client } = makeConnectingGateway({
      verify: vi.fn(() => ({ sub: 7, ver: 1 })),
      user: makeUser({ permissions: [] }),
    });

    await gateway.handleConnection(client as never);

    // A new token would be refused the same way, so the client must not retry.
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
