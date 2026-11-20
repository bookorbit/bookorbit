/**
 * How long a worker waits after an empty read before it looks again unwoken. Work queued in this
 * process wakes its worker at once, so this only bounds how late a worker notices work it was not
 * told about: a write from another server, or a retry whose wait has passed.
 */
export const IDLE_POLL_INTERVAL_MS = 60_000;

/** Lets a worker skip database polls after an empty read. Regular ticks still discover remote work. */
export class IdlePoll {
  private nextPollAt = 0;
  private wakeVersion = 0;

  wake(): void {
    this.wakeVersion++;
    this.nextPollAt = 0;
  }

  begin(): (() => void) | undefined {
    const now = performance.now();
    if (now < this.nextPollAt) return;
    const version = this.wakeVersion;
    return () => {
      // A write can commit after the query's snapshot but before the empty result reaches the worker.
      if (version === this.wakeVersion) this.nextPollAt = now + IDLE_POLL_INTERVAL_MS;
    };
  }
}
