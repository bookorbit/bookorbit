type WorkHandler = (fileId: number) => Promise<void>;
type ErrorHandler = (fileId: number, error: unknown) => void;
type PendingOrder = 'fifo' | 'lifo' | 'priority-desc';

export interface BookDockWorkPriority {
  primary: number;
  secondary?: number;
}

interface DelayRange {
  minMs: number;
  maxMs: number;
}

interface BookDockWorkQueueOptions {
  pendingOrder?: PendingOrder;
  drainDelayMs?: number;
  interJobDelayMs?: DelayRange;
}

interface PendingEntry {
  fileId: number;
  priority: BookDockWorkPriority;
}

export class BookDockWorkQueue {
  private readonly pending: PendingEntry[] = [];
  private readonly queued = new Set<number>();
  private readonly running = new Set<number>();
  private readonly idleResolvers: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private nextDrainNotBeforeMs = 0;
  private activeCount = 0;
  private stopped = false;
  private paused = false;

  constructor(
    private readonly concurrency: number,
    private readonly handler: WorkHandler,
    private readonly onError: ErrorHandler,
    private readonly options: BookDockWorkQueueOptions = {},
  ) {}

  enqueue(fileId: number, priority?: BookDockWorkPriority): boolean {
    if (this.stopped || !Number.isInteger(fileId) || fileId < 1) return false;
    if (this.queued.has(fileId) || this.running.has(fileId)) return false;

    this.queued.add(fileId);
    this.pending.push({ fileId, priority: priority ?? { primary: fileId, secondary: fileId } });
    this.scheduleDrain({ includeDrainDelay: true });
    return true;
  }

  pause(): void {
    if (this.stopped) return;
    this.paused = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.scheduleDrain({ includeDrainDelay: true });
  }

  stop(): void {
    this.stopped = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.pending.length = 0;
    this.queued.clear();
    this.resolveIdleIfNeeded();
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private scheduleDrain({ includeDrainDelay }: { includeDrainDelay: boolean }): void {
    if (this.stopped || this.paused || this.pending.length === 0 || this.activeCount >= this.concurrency) return;

    const drainDelayMs = includeDrainDelay && this.activeCount === 0 ? (this.options.drainDelayMs ?? 0) : 0;
    const delayMs = Math.max(drainDelayMs, this.nextDrainNotBeforeMs - Date.now());
    if (delayMs > 0) {
      if (this.drainTimer) clearTimeout(this.drainTimer);
      this.drainTimer = setTimeout(() => {
        this.drainTimer = null;
        this.drain();
      }, delayMs);
      return;
    }

    this.drain();
  }

  private drain(): void {
    while (!this.stopped && !this.paused && this.activeCount < this.concurrency && this.pending.length > 0) {
      const { fileId } = this.takeNextPending();
      this.queued.delete(fileId);
      this.running.add(fileId);
      this.activeCount++;

      void this.handler(fileId)
        .catch((error) => this.onError(fileId, error))
        .finally(() => {
          this.running.delete(fileId);
          this.activeCount--;
          this.markInterJobDelay();
          this.scheduleDrain({ includeDrainDelay: false });
          this.resolveIdleIfNeeded();
        });
    }

    this.resolveIdleIfNeeded();
  }

  private takeNextPending(): PendingEntry {
    if (this.options.pendingOrder === 'lifo') {
      return this.pending.pop()!;
    }

    if (this.options.pendingOrder !== 'priority-desc') {
      return this.pending.shift()!;
    }

    let bestIndex = 0;
    for (let index = 1; index < this.pending.length; index++) {
      if (comparePriorityDesc(this.pending[index].priority, this.pending[bestIndex].priority) < 0) {
        bestIndex = index;
      }
    }

    const [entry] = this.pending.splice(bestIndex, 1);
    return entry;
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.activeCount === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  private markInterJobDelay(): void {
    const delayMs = this.resolveInterJobDelayMs();
    if (delayMs <= 0) return;
    this.nextDrainNotBeforeMs = Date.now() + delayMs;
  }

  private resolveInterJobDelayMs(): number {
    const range = this.options.interJobDelayMs;
    if (!range) return 0;

    const minMs = Math.max(0, Math.floor(range.minMs));
    const maxMs = Math.max(minMs, Math.floor(range.maxMs));
    if (minMs === maxMs) return minMs;
    return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  }
}

function comparePriorityDesc(left: BookDockWorkPriority, right: BookDockWorkPriority): number {
  if (left.primary !== right.primary) return right.primary - left.primary;
  return (right.secondary ?? 0) - (left.secondary ?? 0);
}
