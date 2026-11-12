import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { AiJobSubjectRef } from '@bookorbit/types';

export const AI_JOB_CHANGED = 'ai-job.changed';

/**
 * `state`: the job moved between statuses, so the place of every queued job may have moved too.
 * `progress`: only the job's own counts or spend changed.
 */
export type AiJobChangeKind = 'state' | 'progress';

export interface AiJobChange {
  id: string;
  feature: string;
  subjectRef: AiJobSubjectRef;
  /** Who the job runs for now; null once their account is gone. */
  requestedBy: number | null;
  kind: AiJobChangeKind;
}

/**
 * Every write to a job's row, as it lands. In process only: a server hears the writes it makes
 * itself, so a page connected to another server still needs its slow poll.
 */
@Injectable()
export class AiJobChanges extends EventEmitter {
  private readonly logger = new Logger(AiJobChanges.name);

  changed(change: AiJobChange): void {
    try {
      this.emit(AI_JOB_CHANGED, change);
    } catch (error) {
      // A listener must never fail the write that has already happened.
      this.logger.warn(`[ai_jobs.change] [fail] jobId=${change.id} errorClass=${error instanceof Error ? error.name : 'Error'} - listener threw`);
    }
  }
}
