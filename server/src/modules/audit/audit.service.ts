import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getAuditCategory, type AuditLogSummary, type AuditSignInPage } from '@bookorbit/types';

import { APP_SETTING_KEYS, DEFAULT_AUDIT_RETENTION_DAYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventPayload, AuditEventsService } from './audit-events.service';
import { AuditRepository, AuditLogFilters, AuditLogQuery, AuditSignInQuery, hasTargetLabels } from './audit.repository';

export type { AuditLogFilters };
import { AuditTargetLabelService, type AuditLogRow } from './audit-target-label.service';
import { AppSettingsService } from '../app-settings/app-settings.service';

const MAX_CONCURRENT_WRITES = 20;
const EXPORT_BATCH_SIZE = 500;
const EXPORT_COLUMNS = [
  'id',
  'occurred_at',
  'actor',
  'user_id',
  'action',
  'category',
  'target_type',
  'target_id',
  'target',
  'ip',
  'description',
  'meta',
];

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly boundHandler: (payload: AuditEventPayload) => void;
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(
    private readonly auditEvents: AuditEventsService,
    private readonly auditRepository: AuditRepository,
    private readonly appSettings: AppSettingsService,
    private readonly targetLabels: AuditTargetLabelService,
  ) {
    this.boundHandler = this.handleAuditEvent.bind(this);
  }

  onModuleInit() {
    this.auditEvents.on(AUDIT_EVENT, this.boundHandler);
  }

  async onModuleDestroy() {
    this.auditEvents.off(AUDIT_EVENT, this.boundHandler);
    await Promise.allSettled(this.pendingWrites);
  }

  private handleAuditEvent(payload: AuditEventPayload): void {
    if (this.pendingWrites.size >= MAX_CONCURRENT_WRITES) {
      this.logger.warn(`[audit.write] [fail] action=${payload.action} error="write queue full" - audit write dropped`);
      return;
    }

    const write = this.record(payload).catch((err: unknown) => {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[audit.write] [fail] action=${payload.action} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - audit write failed`,
      );
    });

    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));
  }

  async getAuditLogs(query: AuditLogQuery): Promise<{ data: AuditLogRow[]; total: number }> {
    const { data, total } = await this.auditRepository.findAll(query);
    return { data: await this.targetLabels.attach(data), total };
  }

  async getSummary(filters: AuditLogFilters): Promise<AuditLogSummary> {
    const [summary, retentionDays] = await Promise.all([this.auditRepository.summarize(filters), this.getRetentionDays()]);
    return {
      kinds: summary.kinds,
      categories: summary.categories,
      securityGroups: summary.securityGroups,
      retentionDays,
      oldestAt: summary.oldestAt?.toISOString() ?? null,
    };
  }

  async getSignIns(query: AuditSignInQuery): Promise<AuditSignInPage> {
    const { data, total } = await this.auditRepository.findSignInGroups(query);
    const names = await this.targetLabels.actorNames(data.map((group) => group.userId));
    return {
      data: data.map((group) => ({
        ...group,
        actorName: group.userId !== null ? (names.get(group.userId) ?? null) : null,
        firstAt: new Date(group.firstAt).toISOString(),
        lastAt: new Date(group.lastAt).toISOString(),
      })),
      total: Number(total),
    };
  }

  /** Every matching event, oldest first, in batches so memory stays flat however long the log is. */
  async *exportEvents(filters: AuditLogFilters, format: 'csv' | 'json'): AsyncGenerator<string> {
    const start = Date.now();
    let exported = 0;
    let afterId = 0;
    this.logger.log(`[audit.export] [start] format=${format} - audit export started`);
    try {
      yield format === 'csv' ? EXPORT_COLUMNS.join(',') + '\n' : '[';
      for (;;) {
        const batch = await this.auditRepository.findExportBatch(filters, afterId, EXPORT_BATCH_SIZE);
        if (batch.length === 0) break;
        const rows = await this.targetLabels.attach(batch);
        for (const row of rows) {
          if (format === 'csv') yield csvLine(row) + '\n';
          else yield (exported > 0 ? ',' : '') + JSON.stringify(jsonRow(row));
          exported++;
        }
        afterId = batch[batch.length - 1].id;
        if (batch.length < EXPORT_BATCH_SIZE) break;
      }
      if (format === 'json') yield ']\n';
      this.logger.log(`[audit.export] [end] format=${format} exported=${exported} durationMs=${Date.now() - start} - audit export finished`);
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[audit.export] [fail] format=${format} exported=${exported} durationMs=${Date.now() - start} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - audit export failed`,
      );
      throw err;
    }
  }

  async getActors(query: string | undefined, limit: number) {
    const actors = await this.auditRepository.findActors(query, limit);
    const names = await this.targetLabels.actorNames(actors.map((actor) => actor.userId));
    return actors.map((actor) => ({ ...actor, name: actor.userId !== null ? (names.get(actor.userId) ?? null) : null }));
  }

  record(payload: AuditEventPayload): Promise<void> {
    const needsLabel = payload.resourceLabel === undefined && hasTargetLabels(payload.resource) && Number.isInteger(payload.resourceId);
    if (!needsLabel) return this.insert(payload, payload.resourceLabel ?? null);
    return this.targetLabels.resolveForWrite(payload.resource, payload.resourceId).then((label) => this.insert(payload, label));
  }

  private insert(payload: AuditEventPayload, resourceLabel: string | null): Promise<void> {
    return this.auditRepository.insert({
      userId: payload.userId,
      actorUsername: payload.actorUsername,
      action: payload.action,
      resource: payload.resource ?? null,
      resourceId: payload.resourceId ?? null,
      resourceLabel,
      description: payload.description,
      ip: payload.ip ?? null,
      meta: payload.meta ?? null,
    });
  }

  getReadingInsightsAccess(subjectUserId: number, page: number, pageSize: number) {
    return this.auditRepository.findReadingInsightsAccess(subjectUserId, page, pageSize);
  }

  async getRetentionDays(): Promise<number> {
    try {
      const value = await this.appSettings.getValue(APP_SETTING_KEYS.AUDIT_RETENTION_DAYS);
      if (!value) return DEFAULT_AUDIT_RETENTION_DAYS;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) || parsed <= 0 ? DEFAULT_AUDIT_RETENTION_DAYS : parsed;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[audit.retention_days] [fail] errorClass=${errorClass} error="${sanitizeLogValue(error)}" - failed to read retention days, using default`,
      );
      return DEFAULT_AUDIT_RETENTION_DAYS;
    }
  }

  async runRetentionCleanup(): Promise<void> {
    const days = await this.getRetentionDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const start = Date.now();
    this.logger.log(`[audit.retention_cleanup] [start] retentionDays=${days} - audit retention cleanup started`);
    try {
      await this.auditRepository.deleteOlderThan(cutoff);
      this.logger.log(`[audit.retention_cleanup] [end] retentionDays=${days} durationMs=${Date.now() - start} - audit retention cleanup completed`);
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[audit.retention_cleanup] [fail] retentionDays=${days} durationMs=${Date.now() - start} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - audit retention cleanup failed`,
      );
      throw err;
    }
  }
}

function jsonRow(row: AuditLogRow) {
  return {
    id: row.id,
    occurredAt: new Date(row.createdAt).toISOString(),
    actorUsername: row.actorUsername,
    userId: row.userId,
    action: row.action,
    category: getAuditCategory(row.action),
    resource: row.resource,
    resourceId: row.resourceId,
    targetLabel: row.targetLabel,
    ip: row.ip,
    description: row.description,
    meta: row.meta,
  };
}

function csvLine(row: AuditLogRow): string {
  const r = jsonRow(row);
  return [
    r.id,
    r.occurredAt,
    r.actorUsername,
    r.userId,
    r.action,
    r.category,
    r.resource,
    r.resourceId,
    r.targetLabel,
    r.ip,
    r.description,
    r.meta ? JSON.stringify(r.meta) : '',
  ]
    .map(csvCell)
    .join(',');
}

/** Quotes a CSV cell, and defuses spreadsheet formulas so an exported name can never run as one. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) || text !== raw ? `"${text.replace(/"/g, '""')}"` : text;
}
