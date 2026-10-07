import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

export const READING_ATTEMPT_CHANGED = 'reading-attempt.changed';

export interface ReadingAttemptChangedPayload {
  userId: number | null;
}

type ChangeBatch = { pending: Set<number | null>; closed: boolean };

// Notifications invalidate only this process; other replicas fall back to their cache TTLs.
@Injectable()
export class ReadingAttemptEventsService extends EventEmitter {
  private readonly logger = new Logger(ReadingAttemptEventsService.name);
  private readonly context = new AsyncLocalStorage<ChangeBatch>();
  private readonly batches = new Set<ChangeBatch>();

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName !== READING_ATTEMPT_CHANGED) return super.emit(eventName, ...args);
    const payload = args[0] as ReadingAttemptChangedPayload;
    this.notifyChanged(payload.userId);
    return this.listenerCount(eventName) > 0;
  }

  notifyChanged(userId: number | null): void {
    const batch = this.context.getStore();
    if (batch && !batch.closed) batch.pending.add(userId);
    else this.publish(userId);
  }

  async coalesceChanges<T>(operation: () => T | Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent && !parent.closed) return operation();
    const batch: ChangeBatch = { pending: new Set(), closed: false };
    this.batches.add(batch);
    try {
      return await this.context.run(batch, operation);
    } finally {
      batch.closed = true;
      this.batches.delete(batch);
      for (const userId of batch.pending) this.publish(userId);
    }
  }

  // A read during a bulk operation must observe all changes that have already committed.
  flushPendingChanges(userId: number): void {
    let changed = false;
    let allChanged = false;
    for (const batch of this.batches) {
      changed = batch.pending.delete(userId) || changed;
      allChanged = batch.pending.delete(null) || allChanged;
    }
    if (allChanged) this.publish(null);
    else if (changed) this.publish(userId);
  }

  private publish(userId: number | null): void {
    for (const listener of this.rawListeners(READING_ATTEMPT_CHANGED)) {
      try {
        listener.call(this, { userId } satisfies ReadingAttemptChangedPayload);
      } catch (error) {
        this.logger.warn(
          `[reading_attempt.notify] [fail] userId=${userId ?? 'all'} durationMs=0 errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - cache listener failed`,
        );
      }
    }
  }
}
