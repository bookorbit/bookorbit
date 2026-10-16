import { Injectable, Logger } from '@nestjs/common';
import { AuditResource } from '@bookorbit/types';

import type { AuditLog } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AuditRepository, hasTargetLabels, targetKey, type AuditTargetRef } from './audit.repository';

const LABEL_MAX_LENGTH = 255;

export type AuditLogRow = Omit<AuditLog, 'resourceLabel'> & { actorName: string | null; targetLabel: string | null; targetExists: boolean | null };

/**
 * Names audit targets. A target that still exists shows its current name; one that is gone shows the
 * last name the log recorded for it, which is why every event snapshots its target's name on write.
 */
@Injectable()
export class AuditTargetLabelService {
  private readonly logger = new Logger(AuditTargetLabelService.name);

  constructor(private readonly repository: AuditRepository) {}

  async resolveForWrite(resource: string | null | undefined, resourceId: number | null | undefined): Promise<string | null> {
    if (!hasTargetLabels(resource) || !Number.isInteger(resourceId)) return null;
    try {
      const labels = await this.repository.findLiveLabels([{ resource, resourceId: resourceId! }]);
      return labels.get(targetKey(resource, resourceId!))?.slice(0, LABEL_MAX_LENGTH) ?? null;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[audit.target_label] [fail] resource=${resource} resourceId=${resourceId} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - target name not recorded`,
      );
      return null;
    }
  }

  /** Display names for the people behind events; accounts that no longer exist are simply absent. */
  async actorNames(userIds: Array<number | null>): Promise<Map<number, string>> {
    const ids = [...new Set(userIds.filter((id): id is number => id !== null))];
    const labels = await this.repository.findLiveLabels(ids.map((id) => ({ resource: AuditResource.User, resourceId: id })));
    return new Map(
      ids.flatMap((id) => (labels.has(targetKey(AuditResource.User, id)) ? [[id, labels.get(targetKey(AuditResource.User, id))!] as const] : [])),
    );
  }

  async attach(rows: AuditLog[]): Promise<AuditLogRow[]> {
    const seen = new Set<string>();
    const targetKeys = new Set<string>();
    const lookups: AuditTargetRef[] = [];
    const want = (resource: string, resourceId: number) => {
      const key = targetKey(resource, resourceId);
      if (seen.has(key)) return;
      seen.add(key);
      lookups.push({ resource, resourceId });
    };
    for (const row of rows) {
      if (hasTargetLabels(row.resource) && row.resourceId !== null) {
        want(row.resource, row.resourceId);
        targetKeys.add(targetKey(row.resource, row.resourceId));
      }
      if (row.userId !== null) want(AuditResource.User, row.userId);
    }
    // One lookup covers both the targets and the people, since people are user targets too.
    const live = await this.repository.findLiveLabels(lookups);
    const missing = lookups.filter(
      (ref) => targetKeys.has(targetKey(ref.resource, ref.resourceId)) && !live.has(targetKey(ref.resource, ref.resourceId)),
    );
    const snapshots = await this.repository.findSnapshotLabels(missing);

    return rows.map(({ resourceLabel, ...row }) => {
      const actorName = row.userId !== null ? (live.get(targetKey(AuditResource.User, row.userId)) ?? null) : null;
      if (!row.resource || row.resourceId === null) return { ...row, actorName, targetLabel: resourceLabel ?? null, targetExists: null };
      if (!hasTargetLabels(row.resource)) return { ...row, actorName, targetLabel: resourceLabel ?? null, targetExists: null };
      const key = targetKey(row.resource, row.resourceId);
      const current = live.get(key);
      if (current) return { ...row, actorName, targetLabel: current, targetExists: true };
      return { ...row, actorName, targetLabel: resourceLabel ?? snapshots.get(key) ?? null, targetExists: false };
    });
  }
}
