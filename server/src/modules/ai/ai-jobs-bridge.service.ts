import { Injectable } from '@nestjs/common';
import type { AiSlot } from '@bookorbit/types';

import type { AiSlotChoice } from './ai-client.types';

/**
 * What this module needs to know about jobs, without depending on the jobs module. The jobs
 * module registers these when it starts; until it does, nothing is in use and no job exists.
 */
export interface AiJobsHooks {
  /** Unfinished (queued, running or paused) jobs that recorded this connection. */
  countUnfinishedJobsUsing(connectionId: number): Promise<number>;
  /** Which of these job ids still exist. */
  liveJobIds(jobIds: string[]): Promise<Set<string>>;
  /** A short name per job, such as a book's title, for the usage page. */
  jobLabels(jobIds: string[]): Promise<Map<string, string>>;
  /**
   * The connection and model a job recorded for a slot when it started, so its requests stay on
   * them when the slot changes. Null when the job recorded none.
   */
  jobSlotChoice(jobId: string, slot: AiSlot): Promise<AiSlotChoice | null>;
}

@Injectable()
export class AiJobsBridge {
  private hooks: Partial<AiJobsHooks> = {};

  register(hooks: Partial<AiJobsHooks>): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  async countUnfinishedJobsUsing(connectionId: number): Promise<number> {
    return this.hooks.countUnfinishedJobsUsing ? this.hooks.countUnfinishedJobsUsing(connectionId) : 0;
  }

  /** Null when no jobs module is registered, so callers keep what they cannot check. */
  async liveJobIds(jobIds: string[]): Promise<Set<string> | null> {
    return this.hooks.liveJobIds ? this.hooks.liveJobIds(jobIds) : null;
  }

  async jobLabels(jobIds: string[]): Promise<Map<string, string>> {
    return this.hooks.jobLabels && jobIds.length > 0 ? this.hooks.jobLabels(jobIds) : new Map();
  }

  async jobSlotChoice(jobId: string, slot: AiSlot): Promise<AiSlotChoice | null> {
    return this.hooks.jobSlotChoice ? this.hooks.jobSlotChoice(jobId, slot) : null;
  }
}
