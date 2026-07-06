import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StorygraphQueueService } from './storygraph-queue.service';
import { STORYGRAPH_MIN_INTERVAL_MS } from './storygraph.constants';

describe('StorygraphQueueService', () => {
  let service: StorygraphQueueService;

  beforeEach(() => {
    service = new StorygraphQueueService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should not wait on first request', async () => {
    const spy = vi.spyOn(global, 'setTimeout');
    const p = service.throttle(1);
    vi.runAllTimers();
    await p;
    expect(spy).not.toHaveBeenCalled();
  });

  it('should throttle within the interval', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);

    vi.setSystemTime(1050);
    const p = service.throttle(1);
    await vi.runAllTimersAsync();
    await p;
  });

  it('should not wait when interval has passed', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    vi.setSystemTime(1000 + STORYGRAPH_MIN_INTERVAL_MS + 1);
    await service.throttle(1);
  });

  it('should track different users independently', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    vi.setSystemTime(1050);
    await service.throttle(2);
  });

  it('should reset user state', async () => {
    vi.setSystemTime(1000);
    await service.throttle(1);
    service.resetUser(1);
    vi.setSystemTime(1010);
    await service.throttle(1);
  });

  it('should serialize concurrent callers instead of releasing them together', async () => {
    vi.setSystemTime(1000);
    const spy = vi.spyOn(global, 'setTimeout');

    const first = service.throttle(1);
    const second = service.throttle(1);
    const third = service.throttle(1);

    await vi.runAllTimersAsync();
    await Promise.all([first, second, third]);

    const waits = spy.mock.calls.map(([, ms]) => ms);
    expect(waits).toEqual([STORYGRAPH_MIN_INTERVAL_MS, STORYGRAPH_MIN_INTERVAL_MS * 2]);
  });
});
