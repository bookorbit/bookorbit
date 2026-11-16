import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, type BulkRunKind } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { NotificationService } from '../notification/notification.service';
import type { EndedBulkRun } from './bulk-runs.repository';

export interface BulkRunEndContext {
  /** An open response followed the run to its end, so its tab already showed the outcome. */
  watched: boolean;
  /** The run's kind tells its requester about a completed run itself. */
  completionHandled: boolean;
}

const KIND_TITLES: Partial<Record<string, string>> & Record<BulkRunKind, string> = {
  'book-refresh-metadata': 'Refresh book metadata',
  'book-re-extract-cover': 'Re-extract covers',
  'book-embed-audio-cover': 'Embed audiobook covers',
  'author-refresh-metadata': 'Refresh author metadata',
  'book-move': 'Move books',
};

const REASONS: Partial<Record<string, string>> = {
  'credential-revoked': 'Stopped: the API key that started it was revoked or has expired.',
  'access-revoked': 'Stopped: the account that started it can no longer do this.',
  'unknown-kind': "This server can't run this kind of bulk action.",
};

const JOBS_FAILED_URL = '/jobs/activity?view=failed&type=bulk-run';
const JOBS_HISTORY_URL = '/jobs/activity?view=history&type=bulk-run';

/**
 * Tells a requester how a bulk run they are no longer watching ended. A run that completes while
 * its tab still follows it says nothing: the tab already showed it. One that stops, or that a
 * restart cut short, always says so, since nothing else would. A cancelled run never does.
 *
 * Accounts store no locale, so the stored title and message are an English fallback; the web
 * client words these types in the reader's locale from `meta`.
 */
@Injectable()
export class BulkRunNotifier {
  private readonly logger = new Logger(BulkRunNotifier.name);

  constructor(private readonly notifications: NotificationService) {}

  async ended(run: EndedBulkRun, context: BulkRunEndContext): Promise<void> {
    if (run.status === 'completed') {
      if (context.watched || context.completionHandled) return;
      await this.send(run, run.failed > 0 ? NotificationType.BulkRunCompletedWithErrors : NotificationType.BulkRunCompleted);
      return;
    }
    // A removed requester has nobody left to tell.
    if (run.status === 'failed' && run.errorCode !== 'requester-gone') await this.send(run, NotificationType.BulkRunFailed);
  }

  /** Runs the last stop cut short; each can continue from Jobs. */
  async interrupted(runs: readonly EndedBulkRun[]): Promise<void> {
    for (const run of runs) await this.send(run, NotificationType.BulkRunInterrupted);
  }

  private async send(run: EndedBulkRun, type: NotificationType): Promise<void> {
    if (run.requestedBy === null) return;
    const action = KIND_TITLES[run.kind] ?? 'Bulk action';
    try {
      await this.notifications.notify({
        type,
        title: this.title(type, action),
        message: this.message(type, run),
        actionUrl:
          type === NotificationType.BulkRunCompleted || type === NotificationType.BulkRunCompletedWithErrors ? JOBS_HISTORY_URL : JOBS_FAILED_URL,
        meta: {
          runId: run.id,
          kind: run.kind,
          total: run.total,
          processed: run.processed,
          succeeded: run.succeeded,
          failed: run.failed,
          skipped: run.skipped,
          code: run.errorCode ?? null,
        },
        scope: { kind: 'user', userId: run.requestedBy },
      });
    } catch (error) {
      this.logger.warn(
        `[bulk_run.notify] [fail] runId=${run.id} kind=${run.kind} type=${type} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - bulk run notification not delivered`,
      );
    }
  }

  private title(type: NotificationType, action: string): string {
    switch (type) {
      case NotificationType.BulkRunCompleted:
        return `Finished: ${action}`;
      case NotificationType.BulkRunCompletedWithErrors:
        return `Finished with errors: ${action}`;
      case NotificationType.BulkRunInterrupted:
        return `Interrupted: ${action}`;
      default:
        return `Couldn't finish: ${action}`;
    }
  }

  private message(type: NotificationType, run: EndedBulkRun): string {
    switch (type) {
      case NotificationType.BulkRunCompleted:
        return `${run.total} ${run.total === 1 ? 'item' : 'items'} done.`;
      case NotificationType.BulkRunCompletedWithErrors:
        return `${run.failed} of ${run.total} ${run.total === 1 ? 'item' : 'items'} failed.`;
      case NotificationType.BulkRunInterrupted:
        return 'Stopped when the server restarted. Continue picks up where it left off.';
      default:
        return (run.errorCode ? REASONS[run.errorCode] : undefined) ?? 'Stopped on an error.';
    }
  }
}
