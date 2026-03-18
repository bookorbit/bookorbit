export class ProviderThrottleError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super('Provider throttled (HTTP 429)');
    this.name = 'ProviderThrottleError';
  }
}
