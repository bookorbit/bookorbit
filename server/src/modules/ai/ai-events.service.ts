import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

import type { AiFailureCode, AiSlot } from '@bookorbit/types';

/**
 * What changed in the AI settings, for whoever pauses and resumes work by it. The jobs engine
 * resumes a paused job when its cause clears: a connection passing a test, the budget raised, a
 * feature switched on, a slot filled.
 */
export const AI_EVENTS = {
  CONNECTION_HEALTHY: 'connection.healthy',
  CONNECTION_FAILING: 'connection.failing',
  SLOT_FAILING: 'slot.failing',
  SLOT_HEALTHY: 'slot.healthy',
  SLOTS_CHANGED: 'slots.changed',
  BUDGET_CHANGED: 'budget.changed',
  FEATURE_CHANGED: 'feature.changed',
} as const;

export interface AiConnectionEvent {
  connectionId: number;
}

export interface AiConnectionFailingEvent extends AiConnectionEvent {
  code: AiFailureCode;
}

export interface AiSlotFailingEvent {
  slot: AiSlot;
  model: string;
  code: AiFailureCode;
}

export interface AiSlotHealthyEvent {
  slot: AiSlot;
}

export interface AiFeatureChangedEvent {
  feature: string;
  enabled: boolean;
}

@Injectable()
export class AiEventsService extends EventEmitter {}
