import { AI_EFFORTS, isAiEffort, type AiEffort, type AiModelInfo, type AiModelList } from '@bookorbit/types';

import type { JsonSchema } from '../ai-client.types';
import type { AiHttpResponse } from '../ai-network';
import type { AiAdapterUsage, AiProviderError, AiProviderErrorKind } from './ai-adapter.interface';

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A dashboard or login page at the URL rather than an API. */
export function isWebPage(response: AiHttpResponse): boolean {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return true;
  return /^\s*<(!doctype|html|head|body)/i.test(response.text.slice(0, 200));
}

/** Seconds from `retry-after` (seconds or a date) or `retry-after-ms`. */
export function retryAfterSeconds(headers: Headers, now = Date.now()): number | undefined {
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 1000);
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * Usage in whatever shape the provider sent: `prompt_tokens`/`completion_tokens`,
 * `input_tokens`/`output_tokens`, or `promptTokenCount`/`candidatesTokenCount`, with reasoning and
 * cached input where reported. Null when there is nothing recognisable.
 */
export function normaliseUsage(raw: unknown): AiAdapterUsage | null {
  if (!isRecord(raw)) return null;
  const details = (key: string) => (isRecord(raw[key]) ? raw[key] : {});
  const hasAny = ['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens', 'promptTokenCount', 'candidatesTokenCount'].some(
    (key) => typeof raw[key] === 'number',
  );
  if (!hasAny) return null;

  const cacheRead = num(raw.cache_read_input_tokens);
  const cacheWrite = num(raw.cache_creation_input_tokens);
  const input = num(raw.prompt_tokens) + num(raw.input_tokens) + num(raw.promptTokenCount) + cacheRead + cacheWrite;
  const output = num(raw.completion_tokens) + num(raw.output_tokens) + num(raw.candidatesTokenCount);
  const reasoning =
    num(details('completion_tokens_details').reasoning_tokens) +
    num(details('output_tokens_details').reasoning_tokens) +
    num(raw.reasoning_tokens) +
    num(raw.thinking_tokens) +
    num(raw.thoughtsTokenCount);
  const cached =
    num(details('prompt_tokens_details').cached_tokens) +
    num(details('input_tokens_details').cached_tokens) +
    cacheRead +
    num(raw.cachedContentTokenCount);
  const usage: AiAdapterUsage = { input, output, reasoning, cached };
  if (typeof raw.cost === 'number' && Number.isFinite(raw.cost)) usage.cost = raw.cost;
  return usage;
}

const MODEL_WORDS = /\bmodels?\b|deployment|no endpoints found/i;
const CONTEXT_WORDS = /context[ _-]?length|context window|too many tokens|prompt is too long|maximum context|input is too long|reduce the length/i;

/**
 * The error shape most OpenAI-compatible servers use: `{ error: { message, type, code, param } }`,
 * or a bare `{ message }` / `{ detail }`.
 */
export function parseOpenAiStyleError(response: AiHttpResponse): AiProviderError {
  const status = response.status;
  const body = parseJson(response.text);
  const error = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : {};
  const message = pickMessage(error, body, response.text);
  const code = typeof error.code === 'string' ? error.code : typeof error.type === 'string' ? error.type : '';
  const param = typeof error.param === 'string' && error.param ? error.param : undefined;
  const retryAfter = retryAfterSeconds(response.headers);

  const kind = ((): AiProviderErrorKind => {
    if (body === undefined && isWebPage(response)) return 'not-api';
    if (status === 401 || status === 403 || code === 'invalid_api_key') return 'auth';
    if (status === 402 || code === 'insufficient_quota' || /insufficient[_ ]quota|credit/i.test(code)) return 'credit';
    if (code === 'context_length_exceeded' || CONTEXT_WORDS.test(message)) return 'context-length';
    if (status === 404 || code === 'model_not_found')
      return code === 'model_not_found' || MODEL_WORDS.test(message) ? 'model-missing' : 'endpoint-missing';
    if (status === 429) return 'rate-limited';
    // 408: the provider or a proxy in front of it gave up waiting, such as a reply stream that dropped.
    if (status >= 500 || status === 408) return 'server';
    if ((status === 400 || status === 422) && rejectedParameter(param, code, message)) return 'bad-parameter';
    return 'bad-request';
  })();

  return {
    kind,
    status,
    message,
    ...(kind === 'bad-parameter' ? { parameter: rejectedParameter(param, code, message) } : {}),
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
  };
}

const OPTIONAL_PARAMETERS = [
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'response_format',
  'top_p',
  'store',
  'provider',
  'usage',
  'text',
  'reasoning_effort',
  'reasoning',
  'stream_options',
  // Effort shares `output_config` with the schema on Messages, so it can be left out on its own.
  'output_config.effort',
  'output_config',
];

const REFUSAL_WORDS = /unsupported|not supported|unknown|unrecognized|extra inputs|not permitted|does not support|not allowed/i;

/** The optional parameter a 400 names, where it names one this client may leave out. */
export function rejectedParameter(param: string | undefined, code: string, message: string): string | undefined {
  const fromParam = param?.split(/[.[]/)[0];
  if (fromParam && OPTIONAL_PARAMETERS.includes(fromParam)) return fromParam;
  if (!REFUSAL_WORDS.test(`${code} ${message}`)) return undefined;
  // Named in quotes ("Unsupported parameter: 'max_tokens'") or as a field ("temperature: Extra inputs").
  return OPTIONAL_PARAMETERS.find((name) => {
    const escaped = name.replace(/\./g, '\\.');
    return new RegExp(`['"\`]${escaped}['"\`]|(^|\\s)${escaped}:`).test(message);
  });
}

/** True when an error says a field matching `field` is not taken, however the server words it. */
export function refusesField(message: string, field: RegExp): boolean {
  return REFUSAL_WORDS.test(message) && field.test(message);
}

/** The omit keys that carry nothing but the effort, in each API type's request. */
export const EFFORT_PARAMETERS: ReadonlySet<string> = new Set(['reasoning_effort', 'reasoning', 'output_config.effort']);

/**
 * The ways servers name effort when they refuse it: `reasoning_effort`, xAI's `reasoningEffort`,
 * Fireworks' "reasoning effort", Ollama's "reasoning value" and "does not support thinking", and
 * CLIProxyAPI's "valid levels".
 */
const EFFORT_FIELD = /\breasoning[_ ]?effort\b|\breasoningEffort\b|\breasoning value\b|\bsupport thinking\b|\bvalid levels\b/i;
const EFFORT_REFUSAL = new RegExp(`${REFUSAL_WORDS.source}|invalid|not enabled|valid (values|levels)|input should be`, 'i');

/**
 * True when an error refuses the effort field or the level sent in it. Servers word a refused
 * level ("Invalid reasoning_effort: minimal. Valid values are ...") unlike a refused field, which
 * `refusesField` alone misses.
 */
export function refusesEffort(message: string, field: RegExp = EFFORT_FIELD): boolean {
  return field.test(message) && EFFORT_REFUSAL.test(message);
}

function pickMessage(error: Record<string, unknown>, body: unknown, text: string): string {
  if (typeof error.message === 'string') return error.message;
  if (isRecord(body) && typeof body.detail === 'string') return body.detail;
  if (isRecord(body) && typeof body.message === 'string') return body.message;
  if (isRecord(body) && typeof body.error === 'string') return body.error;
  return text.slice(0, 300);
}

/** Model lists in every common shape: `{ data: [...] }`, a bare array, or Gemini's `models[]`. */
export function parseModelList(text: string): AiModelList {
  const body = parseJson(text);
  const items = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : [];
  const models: AiModelInfo[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const model = modelInfo(item);
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }
  return { listed: models.length > 0, models };
}

function modelInfo(item: unknown): AiModelInfo | null {
  if (typeof item === 'string') return { id: item };
  if (!isRecord(item)) return null;
  const rawId = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : null;
  if (!rawId) return null;
  const id = rawId.replace(/^models\//, '');
  const info: AiModelInfo = { id };
  const name =
    typeof item.display_name === 'string'
      ? item.display_name
      : typeof item.displayName === 'string'
        ? item.displayName
        : typeof item.name === 'string' && item.name !== rawId
          ? item.name
          : undefined;
  if (name && name !== id) info.name = name;
  const context = num(item.context_length) || num(item.max_input_tokens) || num(item.inputTokenLimit) || num(item.context_window);
  if (context > 0) info.contextLength = context;
  const topProvider = isRecord(item.top_provider) ? item.top_provider : {};
  const maxOutput = num(item.max_tokens) || num(item.outputTokenLimit) || num(topProvider.max_completion_tokens) || num(item.max_output_tokens);
  if (maxOutput > 0) info.maxOutputTokens = maxOutput;
  // OpenRouter prices per token, as strings.
  if (isRecord(item.pricing)) {
    const input = Number(item.pricing.prompt);
    const output = Number(item.pricing.completion);
    if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
      info.prices = { input: roundPrice(input * 1_000_000), output: roundPrice(output * 1_000_000) };
    }
  }
  const efforts = effortsOf(item);
  if (efforts) info.efforts = efforts;
  const defaultEffort = isRecord(item.reasoning) ? item.reasoning.default_effort : undefined;
  if (isAiEffort(defaultEffort) && (!efforts || efforts.includes(defaultEffort))) info.defaultEffort = defaultEffort;
  return info;
}

/**
 * The levels a model takes, lowest first, from the two lists that publish them: Anthropic's
 * `capabilities.effort` (a flag per level) and OpenRouter's `reasoning.supported_efforts`. Null
 * where the list does not say, which is not the same as a model that takes none.
 */
function effortsOf(item: Record<string, unknown>): AiEffort[] | null {
  const capabilities = isRecord(item.capabilities) ? item.capabilities : null;
  if (capabilities && isRecord(capabilities.effort)) {
    const effort = capabilities.effort;
    if (effort.supported === false) return [];
    return AI_EFFORTS.filter((level) => isRecord(effort[level]) && effort[level].supported === true);
  }

  const reasoning = isRecord(item.reasoning) ? item.reasoning : null;
  const listed = reasoning && Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts.filter(isAiEffort) : [];
  if (listed.length > 0) {
    // A model that always reasons refuses `none`.
    const mandatory = reasoning?.mandatory === true;
    return AI_EFFORTS.filter((level) => listed.includes(level) && !(mandatory && level === 'none'));
  }
  // OpenRouter lists every parameter a model takes; one without reasoning takes no effort.
  if (Array.isArray(item.supported_parameters)) {
    const parameters = item.supported_parameters;
    return parameters.includes('reasoning') || parameters.includes('reasoning_effort') ? null : [];
  }
  return null;
}

function roundPrice(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'multipleOf',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

/**
 * A schema a strict provider accepts: no numeric or length constraints, and objects closed with
 * `additionalProperties: false`. The local validator still enforces the original.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.includes(key)) continue;
      out[key] =
        key === 'properties' && isRecord(value)
          ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child)]))
          : visit(value);
    }
    if (out.type === 'object' || isRecord(out.properties)) out.additionalProperties = false;
    return out;
  };
  return visit(schema) as JsonSchema;
}

/** True when OpenAI's strict mode will take the schema as it is: every property required, every object closed. */
export function isStrictCompatible(schema: JsonSchema): boolean {
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.every(visit);
    if (!isRecord(node)) return true;
    if (isRecord(node.properties)) {
      const required = Array.isArray(node.required) ? node.required : [];
      if (node.additionalProperties !== false) return false;
      if (!Object.keys(node.properties).every((key) => required.includes(key))) return false;
    }
    return Object.entries(node).every(([key, value]) => (key === 'properties' && isRecord(value) ? Object.values(value).every(visit) : visit(value)));
  };
  return visit(schema);
}

/** Added to the system prompt when the schema is not enforced, or JSON mode needs the word "JSON". */
export function jsonInstructions(schema: JsonSchema | undefined): string {
  return schema
    ? `Reply with a single JSON object and nothing else. It must match this JSON schema:\n${JSON.stringify(schema)}`
    : 'Reply with a single JSON object and nothing else.';
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

export function bearerHeaders(key: string | null, extra: Array<{ name: string; value: string }>): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  for (const header of extra) headers[header.name] = header.value;
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

/**
 * A failure a provider reported inside a stream, after a 200. Its status is the one the provider
 * names, when it names a number, else 500: most such failures (an overloaded model, a dropped
 * upstream) pass by themselves.
 */
export function streamedError(raw: unknown): AiProviderError {
  const error = isRecord(raw) ? raw : {};
  const message = typeof error.message === 'string' && error.message ? error.message : 'The provider stopped the answer with an error';
  const code = typeof error.code === 'number' ? error.code : typeof error.status === 'number' ? error.status : 500;
  const status = code >= 400 && code < 600 ? code : 500;
  if (CONTEXT_WORDS.test(message)) return { kind: 'context-length', status, message };
  if (status === 401 || status === 403) return { kind: 'auth', status, message };
  if (status === 429) return { kind: 'rate-limited', status, message };
  return { kind: 'server', status, message };
}
