import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { AUDIT_EVENT, AuditEventPayload, AuditEventsService } from './audit-events.service';
import { AuditRepository, AuditLogQuery } from './audit.repository';
import { AppSettingsService } from '../app-settings/app-settings.service';

const AUDIT_RETENTION_DAYS_KEY = 'audit_retention_days';
const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly boundHandler: (payload: AuditEventPayload) => void;

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

  onModuleDestroy() {
    this.auditEvents.off(AUDIT_EVENT, this.boundHandler);
  }

  private handleAuditEvent(payload: AuditEventPayload): void {
    this.auditRepository
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
        this.logger.error('Failed to write audit log', err);
      });
  }

  getAuditLogs(query: AuditLogQuery) {
    return this.auditRepository.findAll(query);
  }

  async getRetentionDays(): Promise<number> {
    try {
      const value = await this.appSettings.getValue(AUDIT_RETENTION_DAYS_KEY);
      if (!value) return DEFAULT_RETENTION_DAYS;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) || parsed <= 0 ? DEFAULT_RETENTION_DAYS : parsed;
    } catch {
      return DEFAULT_RETENTION_DAYS;
    }
  }

  async runRetentionCleanup(): Promise<void> {
    const days = await this.getRetentionDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    await this.auditRepository.deleteOlderThan(cutoff);
    this.logger.log(`Audit log cleanup: deleted records older than ${days} days`);
  }
}
