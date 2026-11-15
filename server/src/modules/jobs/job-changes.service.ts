import { Injectable, Logger } from '@nestjs/common';
import type { JobType } from '@bookorbit/types';

/** `state`: a job of the type changed status, which can move every queued job's place in it. Otherwise only progress moved. */
export interface JobChange {
  type: JobType;
  /** Who the job runs for; null for ownerless work and deleted accounts. */
  ownerId: number | null;
  state: boolean;
}

export type JobChangeListener = (change: JobChange) => void;

/**
 * Where a module says one of its jobs moved, wherever it already writes a transition or progress.
 * In process only: a page connected to another server still needs its slow poll.
 */
@Injectable()
export class JobChangesService {
  private readonly logger = new Logger(JobChangesService.name);
  private readonly listeners = new Set<JobChangeListener>();

  notify(change: JobChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        // A listener must never fail the write that has already happened.
        this.logger.warn(`[jobs.change] [fail] type=${change.type} errorClass=${error instanceof Error ? error.name : 'Error'} - listener threw`);
      }
    }
  }

  /** Hears every change until the returned function is called. */
  listen(listener: JobChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
