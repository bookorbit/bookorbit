import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { KoboDevice } from './kobo-device.decorator';

describe('KoboDevice decorator', () => {
  it('reads koboDevice context from request', () => {
    const request = {
      koboDevice: {
        deviceId: 8,
        deviceToken: 'tok-8',
        userId: 3,
      },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    class TestController {
      handler() {}
    }

    (KoboDevice() as ParameterDecorator)(TestController.prototype, 'handler', 0);
    const argsMetadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler') as Record<
      string,
      { factory: (data: unknown, context: ExecutionContext) => unknown }
    >;
    const factory = Object.values(argsMetadata)[0].factory;
    const result = factory(undefined, ctx);

    expect(result).toEqual({
      deviceId: 8,
      deviceToken: 'tok-8',
      userId: 3,
    });
  });
});
