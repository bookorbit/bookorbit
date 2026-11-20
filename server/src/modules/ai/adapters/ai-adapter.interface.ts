import type { AiApiType, AiJsonSupport, AiModelList } from '@bookorbit/types';

import type { AiEffort, AiFinish, AiImageMediaType, JsonSchema } from '../ai-client.types';
import type { AiHttpRequest, AiHttpResponse } from '../ai-network';
import type { AiSseEvent } from '../ai-sse';

export type AiMessagePart = { type: 'text'; text: string } | { type: 'image'; mediaType: AiImageMediaType; data: string };

export interface AiMessage {
  role: 'user' | 'assistant';
  /** Plain text, or parts when a picture goes with it. */
  content: string | AiMessagePart[];
}

/** Where to send, and with which credentials. */
export interface AiAdapterTarget {
  baseUrl: string;
  key: string | null;
  headers: Array<{ name: string; value: string }>;
}

export interface AiAdapterRequest {
  model: string;
  system?: string;
  messages: AiMessage[];
  /** How to ask for JSON; `none` for plain text. */
  json: AiJsonSupport | 'none';
  schema?: JsonSchema;
  maxOutputTokens: number;
  /** Sent in the provider's own field when set; unset sends nothing. */
  effort?: AiEffort;
  /** The admin chose the level for the slot, so it is sent even where a feature's own would be left out. */
  effortChosen?: boolean;
  /** Optional parameters this connection and model rejected before, left out from now on. */
  omit: ReadonlySet<string>;
  /** Ask for the reply as server-sent events. Plain text only: no JSON, no schema. */
  stream?: boolean;
}

export interface AiAdapterUsage {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  /** The provider's own dollar figure, when it reports one. */
  cost?: number;
}

export interface AiAdapterResult {
  text: string;
  finish: AiFinish;
  usage: AiAdapterUsage;
  /** False when the provider sent no usage at all. */
  usageReported: boolean;
  model: string;
}

/**
 * What a failed response means, independent of the wire format.
 *
 * - `auth`, `credit`, `spend-limit`, `not-api`, `endpoint-missing`: need the admin; never retried.
 * - `model-missing`: the slot's model is gone.
 * - `rate-limited`, `server` (5xx and 408): retried with backoff.
 * - `bad-parameter`: retried once without `parameter`.
 * - `context-length`: the input is too long for the model.
 * - `bad-request`: anything else the provider refused.
 */
export type AiProviderErrorKind =
  | 'auth'
  | 'credit'
  | 'spend-limit'
  | 'not-api'
  | 'endpoint-missing'
  | 'model-missing'
  | 'rate-limited'
  | 'server'
  | 'bad-parameter'
  | 'context-length'
  | 'bad-request';

export interface AiProviderError {
  kind: AiProviderErrorKind;
  status: number;
  /** The provider's message, unscrubbed: the caller scrubs it before it goes anywhere. */
  message: string;
  parameter?: string;
  retryAfterSeconds?: number;
}

/**
 * What one streamed event says. Usage figures are the latest the provider sent; the client keeps
 * the largest of each, since some providers send running totals and some send them once.
 */
export interface AiStreamPiece {
  delta?: string;
  usage?: AiAdapterUsage;
  finish?: AiFinish;
  model?: string;
  /** The provider reported a failure inside the stream. */
  error?: AiProviderError;
  /** The provider's own end marker; nothing that matters follows. */
  end?: boolean;
}

export type AiSend = (request: AiHttpRequest) => Promise<AiHttpResponse>;

/**
 * One API type. Turning a request into the wire format and back is all an adapter does; retries,
 * JSON validation, budgets and the ledger are the client's. A fourth API type is one more file.
 */
export interface AiAdapter {
  readonly apiType: AiApiType;
  buildRequest(target: AiAdapterTarget, request: AiAdapterRequest): AiHttpRequest;
  /** Null when the body is not a reply this adapter can read; the caller treats that as an error. */
  parseResponse(response: AiHttpResponse): AiAdapterResult | null;
  parseError(response: AiHttpResponse): AiProviderError;
  /** One event of a streamed reply; null for an event that says nothing the client uses. */
  parseStreamEvent(event: AiSseEvent): AiStreamPiece | null;
  /** `listed: false` when the provider has no model list. Throws `AiProviderError` as an `AiProviderFailure`. */
  listModels(target: AiAdapterTarget, send: AiSend): Promise<AiModelList>;
  /**
   * A key check where the model list does not prove one: true or false when the provider has a
   * route for it, null when the small JSON request is the only check.
   */
  checkKey(target: AiAdapterTarget, send: AiSend): Promise<boolean | null>;
}

/** An error response, thrown where an adapter's method sends requests itself. */
export class AiProviderFailure extends Error {
  constructor(readonly error: AiProviderError) {
    super(error.message);
    this.name = 'AiProviderFailure';
  }
}
