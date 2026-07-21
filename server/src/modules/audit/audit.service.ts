import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { APP_SETTING_KEYS, DEFAULT_AUDIT_RETENTION_DAYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventPayload, AuditEventsService } from './audit-events.service';
import { AuditRepository, AuditLogQuery } from './audit.repository';
import { AppSettingsService } from '../app-settings/app-settings.service';

const MAX_CONCURRENT_WRITES = 20;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly boundHandler: (payload: AuditEventPayload) => void;
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(
    private readonly auditEvents: AuditEventsService,
    private readonly auditRepository: AuditRepository,
    private readonly appSettings: AppSettingsService,
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

    const write = this.auditRepository
      .insert({
        userId: payload.userId,
        actorUsername: payload.actorUsername,
        action: payload.action,
        resource: payload.resource ?? null,
        resourceId: payload.resourceId ?? null,
        description: payload.description,
        ip: payload.ip ?? null,
        meta: payload.meta ?? null,
      })
      .catch((err: unknown) => {
        const errorClass = err instanceof Error ? err.constructor.name : 'Error';
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[audit.write] [fail] action=${payload.action} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - audit write failed`,
        );
      });

    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));
  }

  getAuditLogs(query: AuditLogQuery) {
    return this.auditRepository.findAll(query);
  }

  record(payload: AuditEventPayload): Promise<void> {
    return this.auditRepository.insert({
      userId: payload.userId,
      actorUsername: payload.actorUsername,
      action: payload.action,
      resource: payload.resource ?? null,
      resourceId: payload.resourceId ?? null,
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
