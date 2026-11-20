import type { AiModelInfo, AiModelList } from '@bookorbit/types';

import type { AiFinish } from '../ai-client.types';
import type { AiHttpRequest, AiHttpResponse } from '../ai-network';
import type { AiSseEvent } from '../ai-sse';
import type {
  AiAdapter,
  AiAdapterRequest,
  AiAdapterResult,
  AiAdapterTarget,
  AiMessage,
  AiProviderError,
  AiProviderErrorKind,
  AiSend,
  AiStreamPiece,
} from './ai-adapter.interface';
import { AiProviderFailure } from './ai-adapter.interface';
import {
  isRecord,
  isWebPage,
  joinUrl,
  jsonInstructions,
  normaliseUsage,
  parseJson,
  parseModelList,
  refusesEffort,
  rejectedParameter,
  retryAfterSeconds,
  streamedError,
  strictSchema,
} from './ai-adapter-common';

/** Still accepted by Anthropic, and required by Bedrock and Ollama. */
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL_PAGE_LIMIT = 1000;
const MAX_MODEL_PAGES = 10;
/** The omit key for `output_config.effort`, which a model can refuse while it takes `output_config.format`. */
const EFFORT_PARAMETER = 'output_config.effort';

/**
 * Anthropic Messages: Anthropic, and Claude behind Bedrock, OpenRouter, CLIProxyAPI, DeepSeek's
 * `/anthropic` and Ollama. Never sends `temperature` or `top_p`, which newer versions reject.
 */
export class AnthropicMessagesAdapter implements AiAdapter {
  readonly apiType = 'anthropic-messages' as const;

  buildRequest(target: AiAdapterTarget, request: AiAdapterRequest): AiHttpRequest {
    const enforce = request.json === 'schema' && request.schema !== undefined && !request.omit.has('output_config');
    const instruct = request.json !== 'none' && !enforce;
    const system = [request.system, instruct ? jsonInstructions(request.schema) : null].filter(Boolean).join('\n\n');

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      messages: request.messages.map((message) => ({ role: message.role, content: anthropicContent(message.content) })),
    };
    if (system) body.system = system;
    if (request.stream) body.stream = true;
    const outputConfig: Record<string, unknown> = {};
    if (enforce && request.schema) {
      // Schemas here take no numeric or length constraints; the local validator enforces those.
      outputConfig.format = { type: 'json_schema', schema: strictSchema(request.schema) };
    }
    // A chosen level outlives a refused `output_config`, so the refusal reaches the admin instead of
    // the model quietly running at its own default.
    const sendEffort = !request.omit.has(EFFORT_PARAMETER) && (request.effortChosen || !request.omit.has('output_config'));
    if (request.effort && sendEffort) outputConfig.effort = request.effort;
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

    return { method: 'POST', url: joinUrl(target.baseUrl, '/v1/messages'), headers: this.headers(target), body: JSON.stringify(body) };
  }

  parseResponse(response: AiHttpResponse): AiAdapterResult | null {
    const body = parseJson(response.text);
    if (!isRecord(body) || !Array.isArray(body.content)) return null;
    const text = body.content.map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('');
    const usage = normaliseUsage(body.usage);
    const finish = finishOf(body.stop_reason);
    return {
      text: finish === 'refused' ? '' : text,
      finish,
      usage: usage ?? { input: 0, output: 0, reasoning: 0, cached: 0 },
      usageReported: usage !== null,
      model: typeof body.model === 'string' ? body.model : '',
    };
  }

  parseStreamEvent(event: AiSseEvent): AiStreamPiece | null {
    const body = parseJson(event.data);
    if (!isRecord(body)) return null;
    switch (body.type) {
      case 'message_start': {
        const message = isRecord(body.message) ? body.message : {};
        const usage = normaliseUsage(message.usage);
        return {
          ...(typeof message.model === 'string' && message.model ? { model: message.model } : {}),
          ...(usage ? { usage } : {}),
        };
      }
      case 'content_block_delta': {
        const delta = isRecord(body.delta) ? body.delta : {};
        return delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0 ? { delta: delta.text } : null;
      }
      case 'message_delta': {
        const delta = isRecord(body.delta) ? body.delta : {};
        const usage = normaliseUsage(body.usage);
        return {
          ...(delta.stop_reason ? { finish: finishOf(delta.stop_reason) } : {}),
          ...(usage ? { usage } : {}),
        };
      }
      case 'message_stop':
        return { end: true };
      case 'error':
        return { error: streamedError(body.error) };
      default:
        return null;
    }
  }

  parseError(response: AiHttpResponse): AiProviderError {
    const status = response.status;
    const body = parseJson(response.text);
    const error = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : {};
    const type = typeof error.type === 'string' ? error.type : '';
    const message = typeof error.message === 'string' ? error.message : response.text.slice(0, 300);
    const retryAfter = retryAfterSeconds(response.headers);
    const parameter =
      status === 400
        ? (rejectedParameter(undefined, type, message) ?? (refusesEffort(message, /\beffort\b/i) ? EFFORT_PARAMETER : undefined))
        : undefined;

    const kind = ((): AiProviderErrorKind => {
      if (body === undefined && isWebPage(response)) return 'not-api';
      if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return 'auth';
      if (status === 402 || /credit balance/i.test(message)) return 'credit';
      if (/prompt is too long|context window|too many tokens/i.test(message)) return 'context-length';
      if (status === 404) return /model/i.test(message) || type === 'not_found_error' ? 'model-missing' : 'endpoint-missing';
      // Without retry-after, Anthropic's 429 is a spend limit, not a pace to slow to.
      if (status === 429) return retryAfter === undefined ? 'spend-limit' : 'rate-limited';
      if (status >= 500 || status === 408 || type === 'overloaded_error' || type === 'api_error') return 'server';
      if (parameter) return 'bad-parameter';
      return 'bad-request';
    })();

    return {
      kind,
      status,
      message,
      ...(kind === 'bad-parameter' ? { parameter } : {}),
      ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
    };
  }

  async listModels(target: AiAdapterTarget, send: AiSend): Promise<AiModelList> {
    const models: AiModelInfo[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
      const query = `?limit=${MODEL_PAGE_LIMIT}${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
      const response = await send({ method: 'GET', url: joinUrl(target.baseUrl, `/v1/models${query}`), headers: this.headers(target) });
      if (response.status === 404 || response.status === 405) return { listed: models.length > 0, models };
      if (response.status >= 400 || isWebPage(response)) throw new AiProviderFailure(this.parseError(response));
      models.push(...parseModelList(response.text).models);
      const body = parseJson(response.text);
      if (!isRecord(body) || body.has_more !== true || typeof body.last_id !== 'string') break;
      after = body.last_id;
    }
    return { listed: models.length > 0, models };
  }

  checkKey(): Promise<boolean | null> {
    return Promise.resolve(null);
  }

  private headers(target: AiAdapterTarget): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };
    for (const header of target.headers) headers[header.name] = header.value;
    if (target.key) {
      headers['x-api-key'] = target.key;
      // Proxies serving Messages often read the key as a bearer token instead.
      if (!isAnthropic(target.baseUrl)) headers.authorization = `Bearer ${target.key}`;
    }
    return headers;
  }
}

function isAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function finishOf(reason: unknown): AiFinish {
  switch (reason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'refused';
    default:
      return 'stop';
  }
}

function anthropicContent(content: AiMessage['content']): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } },
  );
}
