import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { SensitiveEndpointThrottlerGuard } from './sensitive-endpoint-throttler.guard';

class TestController {
  unthrottled() {}

  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  throttled() {}
}

@Throttle({ default: { limit: 5, ttl: 60_000 } })
class ThrottledController {
  anyMethod() {}
}

function makeContext(handler: () => void, classRef: new (...args: never[]) => unknown = TestController): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;
}

function makeGuard(): SensitiveEndpointThrottlerGuard {
  return new SensitiveEndpointThrottlerGuard(
    { throttlers: [{ name: 'default', limit: 120, ttl: 60_000 }] },
    { increment: vi.fn() } as never,
    new Reflector(),
  );
}

describe('SensitiveEndpointThrottlerGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bypasses handlers without throttle metadata', async () => {
    const guard = makeGuard();
    await guard.onModuleInit();
    const superCanActivate = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(makeContext(TestController.prototype.unthrottled))).resolves.toBe(true);

    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('delegates handlers with method-level throttle metadata to Nest throttler', async () => {
    const guard = makeGuard();
    await guard.onModuleInit();
    const context = makeContext(TestController.prototype.throttled);
    const superCanActivate = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(superCanActivate).toHaveBeenCalledWith(context);
  });

  it('delegates to Nest throttler when the class itself carries throttle metadata', async () => {
    const guard = makeGuard();
    await guard.onModuleInit();
    const context = makeContext(ThrottledController.prototype.anyMethod, ThrottledController);
    const superCanActivate = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(superCanActivate).toHaveBeenCalledWith(context);
  });

  it('uses configured throttlers from options when throttlers list is not yet populated', async () => {
    const guard = new SensitiveEndpointThrottlerGuard(
      { throttlers: [{ name: 'default', limit: 10, ttl: 60_000 }] },
      { increment: vi.fn() } as never,
      new Reflector(),
    );
    const context = makeContext(TestController.prototype.throttled);
    const superCanActivate = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(superCanActivate).toHaveBeenCalledWith(context);
  });
});
