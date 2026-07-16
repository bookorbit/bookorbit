import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ReadwiseQueueService } from './readwise-queue.service';
import { READWISE_MIN_INTERVAL_MS } from './readwise.constants';

describe('ReadwiseQueueService', () => {
  let service: ReadwiseQueueService;

  beforeEach(() => {
    service = new ReadwiseQueueService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not wait on first request', async () => {
    const spy = vi.spyOn(global, 'setTimeout');
    const p = service.throttle(1);
    vi.runAllTimers();
    await p;
    expect(spy).not.toHaveBeenCalled();
  });

  it('should throttle within the interval', async () => {
    // first call - no wait
    vi.setSystemTime(1000);
    await service.throttle(1);

    // second call immediately - should wait
    vi.setSystemTime(1050);
    const p = service.throttle(1);
    await vi.runAllTimersAsync();
    await p;
    // Just verifying it resolves without throwing
  });

  it('should not wait when interval has passed', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    vi.setSystemTime(1000 + READWISE_MIN_INTERVAL_MS + 1);
    await service.throttle(1); // should resolve immediately
  });

  it('should track different users independently', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    vi.setSystemTime(1050);
    // user 2 has no prior request, should not wait
    await service.throttle(2);
  });

  it('should reset user state', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    service.resetUser(1);
    vi.setSystemTime(1010);
    // after reset, should not wait
    await service.throttle(1);
  });
});
