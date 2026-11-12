import { Injectable, Logger } from '@nestjs/common';
import type { AiJobFailureReason } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobRow } from '../../db/schema';
import { NotificationService } from '../notification/notification.service';
import { UserService } from '../user/user.service';
import type { AiJobInfo, AiJobOutcome } from './ai-feature';
import { AiFeatureRegistry } from './ai-feature.registry';
import { mayRun } from './ai-job-checks.service';

/**
 * Tells the requester when a job finishes or fails, through the server's in-app notifications. It is
 * called only by whoever moved the job into that state, so each outcome is sent once. Best effort:
 * a notification that cannot be sent never changes the job.
 *
 * A requester who could no longer start the job (account off, permission or book gone) is not told.
 */
@Injectable()
export class AiJobNotifier {
  private readonly logger = new Logger(AiJobNotifier.name);

  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly users: UserService,
    private readonly notifications: NotificationService,
  ) {}

  async notify(row: AiJobRow, outcome: AiJobOutcome): Promise<void> {
    if (row.requestedBy == null) return;
    try {
      const feature = this.registry.get(row.feature);
      if (!feature) return;
      const user = await this.users.findByIdWithPermissions(row.requestedBy);
      if (!user || !mayRun(user, feature) || !(await feature.canReach(user, row.subjectRef))) return;
      const reason = outcome === 'failed' ? ((row.reason as AiJobFailureReason | null) ?? 'error') : null;
      const notice = await feature.notice(jobInfo(row), outcome, reason);
      if (!notice) return;
      await this.notifications.notify({
        type: notice.type,
        title: notice.title,
        ...(notice.message ? { message: notice.message } : {}),
        ...(notice.actionUrl ? { actionUrl: notice.actionUrl } : {}),
        meta: { ...notice.meta, jobId: row.id, feature: row.feature, kind: row.kind, reason },
        scope: { kind: 'user', userId: row.requestedBy },
      });
    } catch (error) {
      this.logger.warn(
        `[ai_jobs.notify] [fail] jobId=${row.id} feature=${row.feature} outcome=${outcome} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - AI job notification not delivered`,
      );
    }
  }
}

export function jobInfo(row: AiJobRow): AiJobInfo {
  return {
    id: row.id,
    feature: row.feature,
    kind: row.kind as AiJobInfo['kind'],
    subjectKey: row.subjectKey,
    subjectRef: row.subjectRef,
    generation: row.generation,
    models: row.models ?? {},
  };
}
