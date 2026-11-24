import type { AiEffort, AiErrorCode, AiFailureCode, AiJsonMode, AiModelPrices, AiSlot } from '@bookorbit/types';

/** The subset of JSON Schema the adapters send and the local validator enforces. */
export type JsonSchema = Record<string, unknown>;

/** The connection, model and terms a slot resolved to. A job records it at start and passes it back. */
export interface AiSlotChoice {
  slot: AiSlot;
  connectionId: number;
  model: string;
  prices: AiModelPrices | null;
  jsonMode: AiJsonMode;
  /** The model's output limit, when known; caps the retry of a reply cut short. */
  maxOutputTokens?: number | null;
  /** The level the slot set, which wins over the request's; absent leaves it to the request. */
  effort?: AiEffort;
}

export type { AiEffort };

export type AiImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** A picture sent before the text of the user message. */
export interface AiImage {
  mediaType: AiImageMediaType;
  /** Base64, without a `data:` prefix. */
  data: string;
  width: number;
  height: number;
}

export interface AiRequest {
  /** Ledger and budget key, such as `story-guides`. */
  feature: string;
  slot: AiSlot;
  system?: string;
  user: string;
  /** Sent ahead of `user` for a model that reads images. */
  images?: AiImage[];
  /** The reply is parsed and validated when set. */
  schema?: JsonSchema;
  maxOutputTokens: number;
  /** The reasoning effort asked of a model that supports it. */
  effort?: AiEffort;
  jobId?: string;
  signal?: AbortSignal;
  /** The choice a job started with, so a slot changed mid-job does not move it. */
  use?: AiSlotChoice;
  /** The reader the request is for, recorded in the ledger for per-reader caps. */
  userId?: number;
}

export interface AiUsage {
  input: number;
  output: number;
  reasoning?: number;
  cached?: number;
  /** Estimated dollars: the provider's own figure when it reports one, else from the slot's prices. */
  cost?: number;
}

export type AiFinish = 'stop' | 'length' | 'refused' | 'filtered';

export interface AiResult {
  text: string;
  json?: unknown;
  /** Every attempt the request was billed for: a reply cut short or sent back for repair counts too. */
  usage: AiUsage;
  finish: AiFinish;
  /** As the provider reported it. */
  model: string;
}

export interface AiErrorDetails {
  failure?: AiFailureCode;
  retryAfterSeconds?: number;
  connectionId?: number;
  /** The provider's message with secrets removed. */
  providerMessage?: string;
  /** For `invalid-json`: what the validator found. */
  validation?: string;
}

/** What `AiClient.complete` throws. Jobs pause or skip by `code`. */
export class AiError extends Error {
  /** What the request's attempts were billed before it failed; absent when nothing was billed. */
  spent?: AiUsage;

  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly details: AiErrorDetails = {},
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}
