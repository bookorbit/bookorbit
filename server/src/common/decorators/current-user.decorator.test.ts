import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import type { RequestUser } from '../types/request-user';
import { CurrentUser } from './current-user.decorator';

function makeUser(): RequestUser {
  return {
    id: 99,
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
    permissions: [],
  };
}

describe('CurrentUser decorator', () => {
  it('registers a route param factory that extracts request.user', () => {
    const user = makeUser();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;

    class TestController {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      method(@CurrentUser() _currentUser: RequestUser) {}
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'method') as Record<
      string,
      { factory?: (data: unknown, context: ExecutionContext) => RequestUser }
    >;
    const paramEntry = Object.values(metadata)[0];

    expect(typeof paramEntry.factory).toBe('function');
    expect(paramEntry.factory?.(undefined, context)).toEqual(user);
  });
});
