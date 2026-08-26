type ImportHandler = (downloadId: number) => Promise<void>;
type ImportErrorHandler = (downloadId: number, error: unknown) => void;

/**
 * Imports, run off whatever noticed the download had finished.
 *
 * Extracting and placing a release takes minutes, and the monitor's tick is a process-wide
 * critical section: awaiting an import inside it stops progress polling and completion handling
 * for every other download until it returns. Handing the id here lets the tick finish immediately.
 *
 * Bounded, and deduplicated by download id. Both the completion path and the fifteen-second resume
 * sweep offer the same download - the row stays `completed` for the whole extraction, so the sweep
 * keeps finding it - and running two imports of one download would place its files twice.
 */
export class RequestImportQueue {
  private readonly pending: number[] = [];
  private readonly queued = new Set<number>();
  private readonly running = new Set<number>();
  private readonly idleResolvers: Array<() => void> = [];
  private stopped = false;

  constructor(
    private readonly concurrency: number,
    private readonly handler: ImportHandler,
    private readonly onError: ImportErrorHandler,
  ) {}

  /** False when the download is already waiting or already being imported, or the queue is done. */
  enqueue(downloadId: number): boolean {
    if (this.stopped || !Number.isInteger(downloadId) || downloadId < 1) return false;
    if (this.queued.has(downloadId) || this.running.has(downloadId)) return false;

    this.queued.add(downloadId);
    this.pending.push(downloadId);
    this.drain();
    return true;
  }

  /**
   * Drops what has not started. Anything already running is left to finish, and anything dropped
   * is picked up by the resume sweep on the next boot: the row is still `completed` with no dock
   * row against it, which is exactly what that sweep looks for.
   */
  stop(): void {
    this.stopped = true;
    this.pending.length = 0;
    this.queued.clear();
    this.resolveIdleIfNeeded();
  }

  /**
   * Every download this queue is holding, waiting or running.
   *
   * Concurrency is one, so a download can wait here for as long as everything ahead of it takes,
   * receiving no writes the whole time. The watchdog ages an import by `updatedAt`, so without a
   * way to say "these are still mine" queue depth alone would fail a healthy import.
   */
  members(): number[] {
    return [...this.pending, ...this.running];
  }

  /** For tests and shutdown, which are the only callers that need the imports to have happened. */
  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private drain(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.length > 0) {
      const downloadId = this.pending.shift()!;
      this.queued.delete(downloadId);
      this.running.add(downloadId);

      void this.handler(downloadId)
        .catch((error: unknown) => this.onError(downloadId, error))
        .finally(() => {
          this.running.delete(downloadId);
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
