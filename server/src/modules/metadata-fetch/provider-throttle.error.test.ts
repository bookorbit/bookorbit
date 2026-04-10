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
});
