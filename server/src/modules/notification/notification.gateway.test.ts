import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { NotificationGateway } from './notification.gateway';

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
