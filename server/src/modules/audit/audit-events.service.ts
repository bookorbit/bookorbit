import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

import type { AuditAction, AuditResource } from '@bookorbit/types';

export const AUDIT_EVENT = 'audit.log';

export interface AuditEventPayload {
  userId: number | null;
  actorUsername: string;
  action: AuditAction;
  resource?: AuditResource;
  resourceId?: number;
  description: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditEventsService extends EventEmitter {}
