export interface StageJob {
  clientId: number;
  clientKey: string;
  downloadId: number;
}

type StageHandler = (job: StageJob) => Promise<void>;
type StageErrorHandler = (job: StageJob, error: unknown) => void;

/**
 * Fetches for cloud downloads, run off the poll tick that noticed them.
 *
 * Staging moves whole releases over minutes, and the tick is a process-wide critical section:
 * awaiting one inside it would stop progress polling for every other download. Jobs are keyed by
 * client and torrent rather than by attempt, because the fetch is the account's work: two attempts
 * referencing the same torrent would be one fetch.
 */
export class RequestStageQueue {
  private readonly pending: StageJob[] = [];
  private readonly queued = new Set<string>();
  private readonly running = new Set<string>();
  private readonly idleResolvers: Array<() => void> = [];
  private stopped = false;

  constructor(
    private readonly concurrency: number,
    private readonly handler: StageHandler,
    private readonly onError: StageErrorHandler,
  ) {}

  /** False when the same client and torrent are already waiting or being fetched, or the queue is done. */
  enqueue(job: StageJob): boolean {
    const key = stageKeyOf(job);
    if (this.stopped || this.queued.has(key) || this.running.has(key)) return false;

    this.queued.add(key);
    this.pending.push(job);
    this.drain();
    return true;
  }

  /** Drops what has not started. What was dropped is offered again by the poll tick on the next boot. */
  stop(): void {
    this.stopped = true;
    this.pending.length = 0;
    this.queued.clear();
    this.resolveIdleIfNeeded();
  }

  /** For tests and shutdown, which are the only callers that need the fetches to have happened. */
  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private drain(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      const key = stageKeyOf(job);
      this.queued.delete(key);
      this.running.add(key);

      void this.handler(job)
        .catch((error: unknown) => this.onError(job, error))
        .finally(() => {
          this.running.delete(key);
          this.drain();
          this.resolveIdleIfNeeded();
        });
    }

    this.resolveIdleIfNeeded();
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.running.size === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleResolvers.splice(0)) resolve();
  }
}

function stageKeyOf(job: StageJob): string {
  return `${job.clientId}:${job.clientKey}`;
}
