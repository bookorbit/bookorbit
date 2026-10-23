import { AsyncLocalStorage } from 'node:async_hooks';

/** `accepted` marks a status the provider treats as a normal answer for that request (e.g. 404 for optional data). */
export type ProviderRequestOutcome =
  { kind: 'status'; status: number; accepted?: boolean } | { kind: 'error'; errorClass: string } | { kind: 'aborted' };

/**
 * Everything a provider did on the network during one live operation, plus anything the provider
 * itself reported about the quality of its answer. The metadata cache only stores an answer when
 * this record shows it was complete; a provider returning `[]` or `null` is otherwise
 * indistinguishable from one that swallowed a failure.
 */
export class ProviderCallRecord {
  private readonly finalOutcomes = new Map<string, ProviderRequestOutcome>();
  private auxiliaryRequestCount = 0;
  private indefiniteAuxiliaryCount = 0;
  private readonly failures: string[] = [];
  private readonly degradations: string[] = [];
  private truncatedFlag = false;
  private attemptCount = 0;

  /**
   * Records a request's outcome. A later attempt for the same request replaces an earlier one, so
   * a retried 503 that then succeeds counts as a success.
   */
  recordRequest(requestKey: string, outcome: ProviderRequestOutcome): void {
    this.attemptCount += 1;
    this.finalOutcomes.set(requestKey, outcome);
  }

  /** A side request (e.g. a cover placeholder check) that informs the answer but does not produce it. */
  recordAuxiliary(definitive: boolean): void {
    this.auxiliaryRequestCount += 1;
    if (!definitive) this.indefiniteAuxiliaryCount += 1;
  }

  markFailed(reason: string): void {
    this.failures.push(reason);
  }

  markDegraded(reason: string): void {
    this.degradations.push(reason);
  }

  markTruncated(): void {
    this.truncatedFlag = true;
  }

  /** Distinct main requests. */
  get mainRequests(): number {
    return this.finalOutcomes.size;
  }

  /** Every outbound attempt, main and auxiliary, for pacing decisions. */
  get outboundRequests(): number {
    return this.attemptCount + this.auxiliaryRequestCount;
  }

  get auxiliaryAllDefinitive(): boolean {
    return this.indefiniteAuxiliaryCount === 0;
  }

  get failureReasons(): readonly string[] {
    return this.failures;
  }

  get degradationReasons(): readonly string[] {
    return this.degradations;
  }

  get truncated(): boolean {
    return this.truncatedFlag;
  }

  /** Requests whose final outcome was not a success, ignoring statuses the caller treats as answers. */
  unsuccessfulRequests(authoritativeStatuses: readonly number[] = []): ProviderRequestOutcome[] {
    const unsuccessful: ProviderRequestOutcome[] = [];
    for (const outcome of this.finalOutcomes.values()) {
      if (outcome.kind !== 'status') {
        unsuccessful.push(outcome);
        continue;
      }
      const ok = (outcome.status >= 200 && outcome.status < 300) || outcome.accepted === true;
      if (!ok && !authoritativeStatuses.includes(outcome.status)) unsuccessful.push(outcome);
    }
    return unsuccessful;
  }
}

const storage = new AsyncLocalStorage<ProviderCallRecord>();

export function runWithProviderCallRecord<T>(record: ProviderCallRecord, fn: () => Promise<T>): Promise<T> {
  return storage.run(record, fn);
}

export function currentProviderCallRecord(): ProviderCallRecord | undefined {
  return storage.getStore();
}

/** Identifies one logical request so retries of it collapse into their final outcome. */
export function providerRequestKey(url: string | URL, init?: { method?: string; body?: unknown }): string {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  return `${method} ${url.toString()} ${body}`;
}

export function recordProviderRequest(requestKey: string, outcome: ProviderRequestOutcome): void {
  storage.getStore()?.recordRequest(requestKey, outcome);
}

export function recordProviderRequestError(requestKey: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const outcome: ProviderRequestOutcome = name === 'AbortError' ? { kind: 'aborted' } : { kind: 'error', errorClass: name };
  recordProviderRequest(requestKey, outcome);
}

export function recordAuxiliaryProviderRequest(definitive: boolean): void {
  storage.getStore()?.recordAuxiliary(definitive);
}

/** The provider got a response it could not use (malformed body, an API error inside a 200). */
export function markProviderFailed(reason: string): void {
  storage.getStore()?.markFailed(reason);
}

/** The provider answered, but with less than a complete result (challenge page, skipped detail). */
export function markProviderDegraded(reason: string): void {
  storage.getStore()?.markDegraded(reason);
}

/** The provider stopped early on its own search budget. */
export function markProviderTruncated(): void {
  storage.getStore()?.markTruncated();
}
