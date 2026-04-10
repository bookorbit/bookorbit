import 'reflect-metadata';

import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';

import { OpdsUser } from './opds-user.decorator';

describe('OpdsUser decorator', () => {
  it('extracts opdsUser from request context', () => {
    class TestController {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler(@OpdsUser() _user: unknown) {}
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler') as Record<
      string,
      { factory: (data: unknown, ctx: ExecutionContext) => unknown }
    >;
    const factory = Object.values(metadata)[0]?.factory;

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          opdsUser: { opdsUserId: 3, userId: 9, username: 'reader' },
        }),
      }),
    } as unknown as ExecutionContext;

    expect(factory).toBeDefined();
    expect(factory(undefined, ctx)).toEqual({
      opdsUserId: 3,
      userId: 9,
      username: 'reader',
    });
  });
});
