export class ProviderThrottleError extends Error {
  constructor(
    readonly retryAfterSeconds?: number,
    reason = 'HTTP 429',
  ) {
    super(`Provider throttled (${reason})`);
    this.name = 'ProviderThrottleError';
  }
}
