import { HttpException } from '@nestjs/common';

import { ApiKeyFailureLimiter } from './api-key-failure-limiter';

describe('ApiKeyFailureLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks an address after repeated refusals and forgets it once the window passes', () => {
    vi.useFakeTimers();
    const limiter = new ApiKeyFailureLimiter();
    for (let i = 0; i < 30; i++) limiter.recordFailure('10.0.0.1');

    expect(() => limiter.assertNotBlocked('10.0.0.1')).toThrow(HttpException);
    expect(() => limiter.assertNotBlocked('10.0.0.2')).not.toThrow();

    vi.advanceTimersByTime(60_000);
    expect(() => limiter.assertNotBlocked('10.0.0.1')).not.toThrow();
  });

  it('does not block below the limit', () => {
    const limiter = new ApiKeyFailureLimiter();
    for (let i = 0; i < 29; i++) limiter.recordFailure(null);
    expect(() => limiter.assertNotBlocked(null)).not.toThrow();
  });
});
