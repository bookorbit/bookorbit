import { AiConnectionLimiter, AiLimiterAbortedError, AiLimiterService } from './ai-limiter';

describe('AiConnectionLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const limits = { maxParallel: 2, requestsPerMinute: null };

  it('lets at most maxParallel through and the next one in when one finishes, first come first served', async () => {
    const limiter = new AiConnectionLimiter();
    const order: number[] = [];
    const releases = await Promise.all([0, 1].map((index) => limiter.acquire(limits).then((release) => (order.push(index), release))));
    const third = limiter.acquire(limits).then((release) => (order.push(2), release));
    const fourth = limiter.acquire(limits).then((release) => (order.push(3), release));
    await vi.advanceTimersByTimeAsync(0);
    expect(limiter.inFlight).toBe(2);
    expect(limiter.waiting).toBe(2);

    releases[0]();
    releases[0]();
    await third;
    expect(order).toEqual([0, 1, 2]);
    expect(limiter.inFlight).toBe(2);
    releases[1]();
    await fourth;
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('starts at most requestsPerMinute in any minute', async () => {
    const limiter = new AiConnectionLimiter();
    const perMinute = { maxParallel: 10, requestsPerMinute: 2 };
    (await limiter.acquire(perMinute))();
    await vi.advanceTimersByTimeAsync(10_000);
    (await limiter.acquire(perMinute))();
    let third = false;
    void limiter.acquire(perMinute).then(() => (third = true));
    await vi.advanceTimersByTimeAsync(49_000);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(third).toBe(true);
  });

  it('holds every new request after a 429, and lets requests in flight finish', async () => {
    const limiter = new AiConnectionLimiter();
    const running = await limiter.acquire(limits);
    limiter.hold(30_000);
    let started = false;
    void limiter.acquire(limits).then(() => (started = true));
    running();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toBe(true);
  });

  it('never shortens a longer hold', async () => {
    const limiter = new AiConnectionLimiter();
    limiter.hold(30_000);
    limiter.hold(5_000);
    let started = false;
    void limiter.acquire(limits).then(() => (started = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toBe(false);
  });

  it('drops a waiter whose signal aborts', async () => {
    const limiter = new AiConnectionLimiter();
    const release = await limiter.acquire({ maxParallel: 1, requestsPerMinute: null });
    const controller = new AbortController();
    const waiting = limiter.acquire({ maxParallel: 1, requestsPerMinute: null }, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AiLimiterAbortedError);
    expect(limiter.waiting).toBe(0);
    release();
    expect(limiter.inFlight).toBe(0);
  });

  it('lets someone waiting on screen in ahead of queued background work, in arrival order among themselves', async () => {
    const limiter = new AiConnectionLimiter();
    const one = { maxParallel: 1, requestsPerMinute: null };
    const order: string[] = [];
    const take = (name: string, release: () => void) => {
      order.push(name);
      release();
    };
    const release = await limiter.acquire(one);
    const queued = [
      limiter.acquire(one).then((next) => take('build-1', next)),
      limiter.acquire(one).then((next) => take('build-2', next)),
      limiter.acquire(one, undefined, 'interactive').then((next) => take('reader-1', next)),
      limiter.acquire(one, undefined, 'interactive').then((next) => take('reader-2', next)),
    ];
    expect(limiter.waiting).toBe(4);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(queued);
    expect(order).toEqual(['reader-1', 'reader-2', 'build-1', 'build-2']);
  });

  it('keeps one limiter per connection', () => {
    const service = new AiLimiterService();
    expect(service.for(1)).toBe(service.for(1));
    expect(service.for(1)).not.toBe(service.for(2));
  });
});
