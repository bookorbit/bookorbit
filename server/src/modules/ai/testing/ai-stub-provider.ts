import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { AiApiType } from '@bookorbit/types';

export interface AiStubRequest {
  apiType: AiApiType;
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, any> | null;
}

export interface AiStubOptions {
  /** The key the stub accepts; null accepts any request, like a local runner. */
  key: string | null;
  /** Null answers 404 on the model list, like a provider without one. */
  models: string[] | null;
  /** Refuse the parameter each API type asks for JSON with, as some models do. */
  rejectJsonParameter: boolean;
  /** Leave usage out of replies. */
  omitUsage: boolean;
  /** Answer every request with an HTML page, as a dashboard URL would. */
  webPage: boolean;
  /** Refuse requests carrying a picture with a 400, as a text-only model does. */
  rejectImages: boolean;
  /** The reply text; the default answers the connection test and Try it correctly. */
  reply: (request: AiStubRequest) => string;
}

export interface AiStubProvider {
  /** The base URL a connection of this type would be saved with. */
  baseUrl(apiType: AiApiType): string;
  requests: AiStubRequest[];
  options: AiStubOptions;
  close(): Promise<void>;
}

const PREFIX: Record<AiApiType, string> = { 'openai-chat': '/chat', 'anthropic-messages': '/anthropic', 'openai-responses': '/responses' };

export const AI_STUB_TRY_NAMES = [
  { name: 'Mr. Bennet', kind: 'person', description: 'A gentleman whose wife brings him news of a new neighbour.' },
  { name: 'Netherfield Park', kind: 'place', description: 'A house nearby that has just been let.' },
  { name: 'Mr. Bingley', kind: 'person', description: 'A single young man of large fortune who has taken Netherfield.' },
];

export const AI_STUB_VISION_BOOKS = [
  { title: 'Pride and Prejudice', author: 'Jane Austen', box: [37, 74, 333, 926] },
  { title: 'Moby-Dick', author: 'Herman Melville', box: [370, 74, 667, 926] },
  { title: 'Dracula', author: null, box: null },
];

/** Three sentences, one more than a term answer keeps, so the server's sentence cap ends it. */
export const AI_STUB_READING_HELP_ANSWER =
  'Mr. Darcy is a proud gentleman who has come to Netherfield with Mr. Bingley. He has just refused to dance with Elizabeth at the assembly. Later he changes his mind.';

/** The default reply: the answer each known prompt asks for. */
export function defaultStubReply(request: AiStubRequest): string {
  const prompt = JSON.stringify(request.body ?? {});
  if (prompt.includes('List the title of each book in this picture'))
    return JSON.stringify({ titles: AI_STUB_VISION_BOOKS.map((book) => book.title) });
  if (prompt.includes('You read the books in a photo')) return JSON.stringify({ books: AI_STUB_VISION_BOOKS });
  if (prompt.includes('checking that a connection works')) return '{"ok":true,"word":"orbit"}';
  if (prompt.includes("reader's guide")) return JSON.stringify({ names: AI_STUB_TRY_NAMES });
  if (prompt.includes('You remind a reader who or what something is')) return AI_STUB_READING_HELP_ANSWER;
  return 'Hello from the stub.';
}

/**
 * A provider on `127.0.0.1` that speaks Chat Completions, Anthropic Messages and OpenAI Responses
 * under one port, for tests that go through the real network code.
 */
export async function startAiStubProvider(options: Partial<AiStubOptions> = {}): Promise<AiStubProvider> {
  const state: AiStubOptions = {
    key: 'sk-stub-test-key-0001',
    models: ['text-embedding-3-small', 'stub-model-a', 'stub-model-b'],
    rejectJsonParameter: false,
    omitUsage: false,
    webPage: false,
    rejectImages: false,
    reply: defaultStubReply,
    ...options,
  };
  const requests: AiStubRequest[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = parseBody(text);
      const path = req.url ?? '/';
      const apiType = (Object.keys(PREFIX) as AiApiType[]).find((type) => path.startsWith(`${PREFIX[type]}/`));
      if (!apiType) return send(res, 404, { error: { message: 'Not found' } });
      const request: AiStubRequest = { apiType, method: req.method ?? 'GET', path: path.slice(PREFIX[apiType].length), headers: req.headers, body };
      requests.push(request);
      handle(state, request, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    baseUrl: (apiType) => (apiType === 'anthropic-messages' ? `${origin}${PREFIX[apiType]}` : `${origin}${PREFIX[apiType]}/v1`),
    requests,
    options: state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function handle(state: AiStubOptions, request: AiStubRequest, res: ServerResponse): void {
  if (state.webPage) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>Dashboard</body></html>');
    return;
  }
  const { apiType, path } = request;
  if (state.key !== null && keyOf(request) !== state.key) return send(res, 401, authError(apiType));

  if (request.method === 'GET' && path.startsWith('/v1/models')) {
    if (!state.models) return send(res, 404, { error: { message: 'Not found' } });
    if (apiType === 'anthropic-messages') {
      return send(res, 200, {
        data: state.models.map((id) => ({ id, type: 'model', display_name: id })),
        has_more: false,
        first_id: state.models[0] ?? null,
        last_id: state.models.at(-1) ?? null,
      });
    }
    return send(res, 200, { object: 'list', data: state.models.map((id) => ({ id, object: 'model' })) });
  }

  const endpoint = { 'openai-chat': '/v1/chat/completions', 'anthropic-messages': '/v1/messages', 'openai-responses': '/v1/responses' }[apiType];
  if (request.method !== 'POST' || path !== endpoint) return send(res, 404, { error: { message: 'Not found' } });

  const body = request.body ?? {};
  if (state.models && !state.models.includes(body.model)) {
    return send(res, 404, { error: { type: 'not_found_error', message: `The model '${body.model}' does not exist`, code: 'model_not_found' } });
  }
  const jsonParameter = { 'openai-chat': 'response_format', 'anthropic-messages': 'output_config', 'openai-responses': 'text' }[apiType];
  if (state.rejectJsonParameter && jsonParameter in body) return send(res, 400, parameterError(apiType, jsonParameter));
  if (state.rejectImages && /"type":"(image|image_url|input_image)"/.test(JSON.stringify(body))) {
    return send(res, 400, { error: { message: 'This model does not support image input', type: 'invalid_request_error' } });
  }

  const text = state.reply(request);
  const usage = state.omitUsage ? undefined : { input: 120, output: 30 };
  if (body.stream === true) return stream(res, apiType, String(body.model), text, usage);
  if (apiType === 'openai-chat') {
    return send(res, 200, {
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      ...(usage ? { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } } : {}),
    });
  }
  if (apiType === 'anthropic-messages') {
    return send(res, 200, {
      id: 'msg_stub',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output } } : {}),
    });
  }
  return send(res, 200, {
    id: 'resp_stub',
    object: 'response',
    status: 'completed',
    model: body.model,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output, output_tokens_details: { reasoning_tokens: 0 } } } : {}),
  });
}

/** The reply as server-sent events, a few words at a time, the way each API type streams. */
function stream(res: ServerResponse, apiType: AiApiType, model: string, text: string, usage: { input: number; output: number } | undefined): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const pieces = text.match(/\S+\s*/g) ?? [];
  const write = (event: string | null, data: unknown) =>
    res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  res.write(': stub keep-alive\n\n');
  if (apiType === 'openai-chat') {
    for (const piece of pieces) write(null, { model, choices: [{ index: 0, delta: { content: piece } }] });
    write(null, { model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    if (usage) write(null, { model, choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output } });
    write(null, '[DONE]');
  } else if (apiType === 'anthropic-messages') {
    write('message_start', { type: 'message_start', message: { model, usage: { input_tokens: usage?.input ?? 0, output_tokens: 1 } } });
    for (const piece of pieces) write('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
    write('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage?.output ?? 0 } });
    write('message_stop', { type: 'message_stop' });
  } else {
    write('response.created', { type: 'response.created', response: { model, status: 'in_progress' } });
    for (const piece of pieces) write('response.output_text.delta', { type: 'response.output_text.delta', delta: piece });
    write('response.completed', {
      type: 'response.completed',
      response: { model, status: 'completed', ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output } } : {}) },
    });
  }
  res.end();
}

function keyOf(request: AiStubRequest): string | null {
  if (request.apiType === 'anthropic-messages') return (request.headers['x-api-key'] as string | undefined) ?? null;
  const auth = request.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}

function authError(apiType: AiApiType): unknown {
  return apiType === 'anthropic-messages'
    ? { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }
    : { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } };
}

function parameterError(apiType: AiApiType, parameter: string): unknown {
  return apiType === 'anthropic-messages'
    ? { type: 'error', error: { type: 'invalid_request_error', message: `${parameter}: Extra inputs are not permitted` } }
    : {
        error: {
          message: `Unsupported parameter: '${parameter}' is not supported with this model.`,
          type: 'invalid_request_error',
          param: parameter,
        },
      };
}

function parseBody(text: string): Record<string, any> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
