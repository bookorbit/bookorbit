import { MetadataProviderKey } from '@bookorbit/types';

import { ProviderThrottleError } from './provider-throttle.error';

describe('ProviderThrottleError', () => {
  it('preserves message, name, and retry-after seconds', () => {
    const error = new ProviderThrottleError(45);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderThrottleError');
    expect(error.message).toBe('Provider throttled (HTTP 429)');
    expect(error.retryAfterSeconds).toBe(45);
  });

  it('supports undefined retry-after seconds', () => {
    const error = new ProviderThrottleError();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('carries no partial candidates unless a caller salvaged some', () => {
    expect(new ProviderThrottleError().partialCandidates).toEqual([]);

    const salvaged = new ProviderThrottleError(undefined, 'bot challenge', [
      { provider: MetadataProviderKey.GOODREADS, providerId: '222794853', title: 'The First Witch of Boston' },
    ]);
    expect(salvaged.partialCandidates).toHaveLength(1);
    expect(salvaged.reason).toBe('bot challenge');
    expect(salvaged.message).toBe('Provider throttled (bot challenge)');
  });
});
