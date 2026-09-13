import { MetadataCandidate } from '@bookorbit/types';

export class ProviderThrottleError extends Error {
  constructor(
    readonly retryAfterSeconds?: number,
    readonly reason = 'HTTP 429',
    /**
     * Candidates the provider had already assembled when it was cut off. A provider that scrapes one
     * detail page per result is usually several books in by the time it is throttled, and those books
     * are complete: the cooldown governs the requests still to come, not the ones that already
     * succeeded. Carrying them on the error is what lets the caller record the cooldown and keep the
     * results in the same step.
     */
    readonly partialCandidates: readonly MetadataCandidate[] = [],
  ) {
    super(`Provider throttled (${reason})`);
    this.name = 'ProviderThrottleError';
  }
}
