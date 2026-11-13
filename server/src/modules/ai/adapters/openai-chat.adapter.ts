import type { AiModelList } from '@bookorbit/types';

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
  AiSend,
  AiStreamPiece,
} from './ai-adapter.interface';
import { AiProviderFailure } from './ai-adapter.interface';
import {
  bearerHeaders,
  isRecord,
  isStrictCompatible,
  isWebPage,
  joinUrl,
  jsonInstructions,
  normaliseUsage,
  parseJson,
  parseModelList,
  parseOpenAiStyleError,
  refusesEffort,
  streamedError,
} from './ai-adapter-common';

function isOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return false;
  }
}

/**
 * OpenAI-compatible Chat Completions: OpenRouter, Gemini's OpenAI endpoint, CLIProxyAPI, Azure,
 * Ollama, LM Studio, vLLM and most hosted APIs.
 */
export class OpenAiChatAdapter implements AiAdapter {
  readonly apiType = 'openai-chat' as const;

  buildRequest(target: AiAdapterTarget, request: AiAdapterRequest): AiHttpRequest {
    const { omit } = request;
    const json = request.json === 'schema' && omit.has('response_format') ? 'instructions' : request.json;
    const openRouter = isOpenRouter(target.baseUrl);

    const system = [request.system, json === 'instructions' || json === 'json' ? jsonInstructions(request.schema) : null]
      .filter(Boolean)
      .join('\n\n');
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...request.messages.map((message) => ({ role: message.role, content: chatContent(message.content) })),
    ];

    const body: Record<string, unknown> = { model: request.model, messages, stream: request.stream === true };
    if (request.stream && !omit.has('stream_options')) body.stream_options = { include_usage: true };
    // `max_tokens` is the form most servers take; OpenAI's reasoning models want the newer name.
    if (!omit.has('max_tokens')) body.max_tokens = request.maxOutputTokens;
    else if (!omit.has('max_completion_tokens')) body.max_completion_tokens = request.maxOutputTokens;
    if (!omit.has('temperature')) body.temperature = 0;

    if (json === 'schema' && request.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'reply', schema: request.schema, strict: isStrictCompatible(request.schema) },
      };
      // A model routed to a provider without JSON schema fails instead of returning loose text.
      if (openRouter && !omit.has('provider')) body.provider = { require_parameters: true };
    } else if (json === 'json' && !omit.has('response_format')) {
      body.response_format = { type: 'json_object' };
    }
    // OpenRouter's `require_parameters` would also rule out every provider of a model without
    // reasoning, and answer 404, so a schema request there leaves a feature's effort to the model's
    // default. A level the admin chose goes in OpenRouter's own `reasoning` field, which more of its
    // providers list than `reasoning_effort`, so it survives the filter wherever it can be honoured.
    const routerFilters = body.provider !== undefined;
    if (request.effort && openRouter && request.effortChosen) {
      if (!omit.has('reasoning')) body.reasoning = { effort: request.effort };
    } else if (request.effort && !omit.has('reasoning_effort') && !routerFilters) {
      body.reasoning_effort = request.effort;
    }
    if (openRouter && !omit.has('usage')) body.usage = { include: true };

    return {
      method: 'POST',
      url: joinUrl(target.baseUrl, '/chat/completions'),
      headers: bearerHeaders(target.key, target.headers),
      body: JSON.stringify(body),
    };
  }

  parseResponse(response: AiHttpResponse): AiAdapterResult | null {
    const body = parseJson(response.text);
    if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) return null;
    const choice: unknown = body.choices[0];
    if (!isRecord(choice)) return null;
    const message = isRecord(choice.message) ? choice.message : {};
    const refusal = typeof message.refusal === 'string' && message.refusal.length > 0;
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? contentText(message.content) : '';
    const usage = normaliseUsage(body.usage);

    return {
      text: refusal ? '' : text,
      finish: refusal ? 'refused' : finishOf(choice.finish_reason),
      usage: usage ?? { input: 0, output: 0, reasoning: 0, cached: 0 },
      usageReported: usage !== null,
      model: typeof body.model === 'string' ? body.model : '',
    };
  }

  parseStreamEvent(event: AiSseEvent): AiStreamPiece | null {
    if (event.data === '[DONE]') return { end: true };
    const body = parseJson(event.data);
    if (!isRecord(body)) return null;
    if (isRecord(body.error)) return { error: streamedError(body.error) };

    const piece: AiStreamPiece = {};
    if (typeof body.model === 'string' && body.model) piece.model = body.model;
    const usage = normaliseUsage(body.usage);
    if (usage) piece.usage = usage;
    const choice: unknown = Array.isArray(body.choices) ? body.choices[0] : undefined;
    if (isRecord(choice)) {
      const delta = isRecord(choice.delta) ? choice.delta : {};
      if (typeof delta.refusal === 'string' && delta.refusal.length > 0) piece.finish = 'refused';
      else if (typeof delta.content === 'string' && delta.content.length > 0) piece.delta = delta.content;
      if (piece.finish === undefined && choice.finish_reason !== null && choice.finish_reason !== undefined)
        piece.finish = finishOf(choice.finish_reason);
    }
    return piece;
  }

  parseError(response: AiHttpResponse): AiProviderError {
    const error = parseOpenAiStyleError(response);
    // Servers name it bare, with no param ("Unrecognized request argument supplied: reasoning_effort"),
    // refuse the level instead ("Invalid reasoning_effort: minimal"), or, like Ollama, refuse any level
    // for a model that does not think ("does not support thinking").
    if (error.kind === 'bad-request' && refusesEffort(error.message)) {
      return { ...error, kind: 'bad-parameter', parameter: 'reasoning_effort' };
    }
    return error;
  }

  async listModels(target: AiAdapterTarget, send: AiSend): Promise<AiModelList> {
    const response = await send({ method: 'GET', url: joinUrl(target.baseUrl, '/models'), headers: bearerHeaders(target.key, target.headers) });
    if (response.status === 404 || response.status === 405) return { listed: false, models: [] };
    if (response.status >= 400 || isWebPage(response)) throw new AiProviderFailure(this.parseError(response));
    return parseModelList(response.text);
  }

  /** OpenRouter lists models without a key, so its own key route is the check there. */
  async checkKey(target: AiAdapterTarget, send: AiSend): Promise<boolean | null> {
    if (!isOpenRouter(target.baseUrl)) return null;
    const response = await send({ method: 'GET', url: joinUrl(target.baseUrl, '/key'), headers: bearerHeaders(target.key, target.headers) });
    if (response.status === 401 || response.status === 403) return false;
    return response.status < 400 ? true : null;
  }
}

function contentText(parts: unknown[]): string {
  return parts.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('');
}

function finishOf(reason: unknown): AiFinish {
  switch (reason) {
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
    case 'safety':
      return 'filtered';
    case 'refusal':
      return 'refused';
    default:
      return 'stop';
  }
}

function chatContent(content: AiMessage['content']): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } },
  );
}
