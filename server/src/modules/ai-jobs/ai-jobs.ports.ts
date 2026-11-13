import type { AiEffort, AiJobModels, AiJobPauseReason, AiJobSlotModel } from '@bookorbit/types';

/**
 * What the jobs engine needs from the AI connection: requests, the models each slot uses, their
 * health, the budget and the per-feature settings. The connection's own services implement these;
 * the engine never reaches past them, so it runs the same against a fake in tests.
 */

export type AiSlot = 'fast' | 'careful';

/** A JSON schema object, passed through to the client unchanged. */
export type AiJsonSchema = Record<string, unknown>;

export interface AiRequest {
  /** For the ledger and the budget. */
  feature: string;
  slot: AiSlot;
  system?: string;
  user: string;
  /** When set, the client parses and validates the reply into `json`. */
  schema?: AiJsonSchema;
  maxOutputTokens: number;
  /** The reasoning effort asked of a model that supports it; a level the slot sets wins. */
  effort?: AiEffort;
  jobId?: string;
  signal?: AbortSignal;
  /** The connection, model and effort the job recorded for this slot, so a slot changed mid-build does not move it. */
  use?: AiJobSlotModel;
}

export interface AiUsage {
  input: number;
  output: number;
  reasoning?: number;
  cached?: number;
  /** Dollars, when the slot has prices or the provider reports it. */
  cost?: number;
}

export interface AiResult {
  text: string;
  json?: unknown;
  usage: AiUsage;
  finish: 'stop' | 'length' | 'refused' | 'filtered';
  /** As the provider reported it. */
  model: string;
}

/** Codes the engine acts on. A code it does not know ends the job with `error`. */
export const AI_ERROR_CODES = [
  'off',
  'slot-empty',
  'budget',
  'provider-auth',
  'model-missing',
  'provider-down',
  'invalid-json',
  'too-long',
  'bad-request',
  'cancelled',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  override readonly name = 'AiError';

  constructor(
    readonly code: AiErrorCode | (string & {}),
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * The client's errors may come from another module's class, so they are recognised by shape: an
 * `Error` named `AiError` with a string `code`.
 */
export function aiErrorCode(error: unknown): string | null {
  if (error instanceof AiError) return error.code;
  if (error instanceof Error && error.name === 'AiError') {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export interface AiClientPort {
  /** Throws an `AiError` with a typed code. */
  complete(request: AiRequest): Promise<AiResult>;
}

export interface AiSlotsPort {
  /** The connection and model each slot uses now. A slot with neither is listed in `missing`. */
  resolve(feature: string, slots: readonly AiSlot[]): Promise<{ models: AiJobModels; missing: AiSlot[] }>;
}

export type AiHealthReason = Extract<AiJobPauseReason, 'provider-auth' | 'provider-down' | 'model-missing' | 'slot-empty'>;

export interface AiHealthPort {
  /** Null while the recorded connections and models work; otherwise why they do not. No request is sent. */
  check(feature: string, models: AiJobModels): Promise<AiHealthReason | null>;
  /** The same answer after testing the connections now. */
  retest(feature: string, models: AiJobModels): Promise<AiHealthReason | null>;
}

export type AiReservation = { ok: true } | { ok: false; reason: 'budget' };

export interface AiBudgetPort {
  /**
   * Reserves the job's estimate in dollars (null when the slots have no prices), or answers `budget`
   * when it does not fit what is left this month. Called whenever the job is claimed and when a
   * paused job checks whether its budget cleared, so it must be idempotent per job.
   */
  reserve(input: { jobId: string; feature: string; amount: number | null }): Promise<AiReservation>;
  /** Returns what the job did not spend. Called once the job has ended. */
  release(jobId: string): Promise<void>;
}

export interface AiFeatureSettings {
  enabled: boolean;
  /** Jobs of this feature allowed to run at once, server-wide. */
  buildsAtOnce: number;
}

export interface AiFeatureSettingsPort {
  get(feature: string): Promise<AiFeatureSettings>;
}

export interface AiJobsPorts {
  client: AiClientPort;
  slots: AiSlotsPort;
  health: AiHealthPort;
  budget: AiBudgetPort;
  settings: AiFeatureSettingsPort;
}

export const AI_JOBS_PORTS = Symbol('AI_JOBS_PORTS');

/** Until the AI connection provides the ports, every feature reads as switched off and nothing runs. */
export const DISCONNECTED_AI_JOBS_PORTS: AiJobsPorts = {
  client: {
    complete: () => Promise.reject(new AiError('off', 'No AI connection is configured')),
  },
  slots: { resolve: (_feature, slots) => Promise.resolve({ models: {}, missing: [...slots] }) },
  health: { check: () => Promise.resolve('slot-empty'), retest: () => Promise.resolve('slot-empty') },
  budget: { reserve: () => Promise.resolve({ ok: true }), release: () => Promise.resolve() },
  settings: { get: () => Promise.resolve({ enabled: false, buildsAtOnce: 1 }) },
};
