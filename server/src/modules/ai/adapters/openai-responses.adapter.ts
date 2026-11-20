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
  refusesField,
  streamedError,
} from './ai-adapter-common';

/**
 * OpenAI Responses: OpenAI's preferred path for reasoning models and the only one for its Pro and
 * Codex models, also served by OpenRouter, CLIProxyAPI, Azure, xAI and vLLM. The reply's text is
 * read from the output items, not a single field.
 */
export class OpenAiResponsesAdapter implements AiAdapter {
  readonly apiType = 'openai-responses' as const;

  buildRequest(target: AiAdapterTarget, request: AiAdapterRequest): AiHttpRequest {
    const { omit } = request;
    const json = (request.json === 'schema' || request.json === 'json') && omit.has('text') ? 'instructions' : request.json;
    const instructions = [request.system, json === 'instructions' || json === 'json' ? jsonInstructions(request.schema) : null]
      .filter(Boolean)
      .join('\n\n');

    const body: Record<string, unknown> = {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, content: responsesContent(message) })),
    };
    if (instructions) body.instructions = instructions;
    if (request.stream) body.stream = true;
    if (!omit.has('max_output_tokens')) body.max_output_tokens = request.maxOutputTokens;
    if (!omit.has('store')) body.store = false;
    if (request.effort && !omit.has('reasoning')) body.reasoning = { effort: request.effort };
    if (json === 'schema' && request.schema) {
      body.text = { format: { type: 'json_schema', name: 'reply', schema: request.schema, strict: isStrictCompatible(request.schema) } };
    } else if (json === 'json') {
      body.text = { format: { type: 'json_object' } };
    }

    return {
      method: 'POST',
      url: joinUrl(target.baseUrl, '/responses'),
      headers: bearerHeaders(target.key, target.headers),
      body: JSON.stringify(body),
    };
  }

  parseResponse(response: AiHttpResponse): AiAdapterResult | null {
    const body = parseJson(response.text);
    if (!isRecord(body) || !Array.isArray(body.output)) return null;

    let text = '';
    let refused = false;
    for (const item of body.output) {
      if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!isRecord(part)) continue;
        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
        if (part.type === 'refusal') refused = true;
      }
    }
    const usage = normaliseUsage(body.usage);
    const finish: AiFinish = refused ? 'refused' : finishOf(body.status, body.incomplete_details);
    return {
      text: refused ? '' : text,
      finish,
      usage: usage ?? { input: 0, output: 0, reasoning: 0, cached: 0 },
      usageReported: usage !== null,
      model: typeof body.model === 'string' ? body.model : '',
    };
  }

  parseStreamEvent(event: AiSseEvent): AiStreamPiece | null {
    const body = parseJson(event.data);
    if (!isRecord(body)) return null;
    const type = typeof body.type === 'string' ? body.type : event.event;
    const response = isRecord(body.response) ? body.response : {};
    const model = typeof response.model === 'string' && response.model ? { model: response.model } : {};
    switch (type) {
      case 'response.output_text.delta':
        return typeof body.delta === 'string' && body.delta.length > 0 ? { delta: body.delta } : null;
      case 'response.refusal.delta':
      case 'response.refusal.done':
        return { finish: 'refused' };
      case 'response.created':
      case 'response.in_progress':
        return model;
      case 'response.completed':
      case 'response.incomplete': {
        const usage = normaliseUsage(response.usage);
        return { ...model, ...(usage ? { usage } : {}), finish: finishOf(response.status, response.incomplete_details), end: true };
      }
      case 'response.failed':
        return { error: streamedError(response.error) };
      case 'error':
        return { error: streamedError(body) };
      default:
        return null;
    }
  }

  parseError(response: AiHttpResponse): AiProviderError {
    const error = parseOpenAiStyleError(response);
    // Responses names its output limit `max_output_tokens`.
    if (error.kind === 'bad-request' && /max_output_tokens/.test(error.message) && /unsupported|unknown|not supported/i.test(error.message)) {
      return { ...error, kind: 'bad-parameter', parameter: 'max_output_tokens' };
    }
    if (error.kind === 'bad-request' && (refusesField(error.message, /\breasoning\b/i) || refusesEffort(error.message))) {
      return { ...error, kind: 'bad-parameter', parameter: 'reasoning' };
    }
    return error;
  }

  async listModels(target: AiAdapterTarget, send: AiSend): Promise<AiModelList> {
    const response = await send({ method: 'GET', url: joinUrl(target.baseUrl, '/models'), headers: bearerHeaders(target.key, target.headers) });
    if (response.status === 404 || response.status === 405) return { listed: false, models: [] };
    if (response.status >= 400 || isWebPage(response)) throw new AiProviderFailure(this.parseError(response));
    return parseModelList(response.text);
  }

  checkKey(): Promise<boolean | null> {
    return Promise.resolve(null);
  }
}

function finishOf(status: unknown, incomplete: unknown): AiFinish {
  if (status !== 'incomplete') return 'stop';
  const reason = isRecord(incomplete) ? incomplete.reason : undefined;
  return reason === 'content_filter' ? 'filtered' : 'length';
}

function responsesContent(message: AiMessage): unknown {
  if (typeof message.content === 'string') return message.content;
  const textType = message.role === 'assistant' ? 'output_text' : 'input_text';
  return message.content.map((part) =>
    part.type === 'text' ? { type: textType, text: part.text } : { type: 'input_image', image_url: `data:${part.mediaType};base64,${part.data}` },
  );
}
