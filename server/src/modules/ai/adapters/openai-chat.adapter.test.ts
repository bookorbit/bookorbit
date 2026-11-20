import type { AiHttpRequest } from '../ai-network';
import type { AiAdapterRequest, AiAdapterTarget } from './ai-adapter.interface';
import { AiProviderFailure } from './ai-adapter.interface';
import { loadFixture } from './fixtures/load-fixture';
import { OpenAiChatAdapter } from './openai-chat.adapter';

const adapter = new OpenAiChatAdapter();
const fixture = (name: string) => loadFixture('openai-chat', name);

const target: AiAdapterTarget = { baseUrl: 'http://localhost:8317/v1', key: 'sk-client-key-123456', headers: [{ name: 'X-Extra', value: 'yes' }] };
const schema = {
  type: 'object',
  properties: {
    names: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, kind: { type: 'string' } },
        required: ['name', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['names'],
  additionalProperties: false,
};
const request = (overrides: Partial<AiAdapterRequest> = {}): AiAdapterRequest => ({
  model: 'gpt-6-luna',
  system: 'Find the names.',
  messages: [{ role: 'user', content: 'It is a truth universally acknowledged...' }],
  json: 'schema',
  schema,
  maxOutputTokens: 800,
  omit: new Set(),
  ...overrides,
});
const bodyOf = (built: AiHttpRequest) => JSON.parse(built.body ?? '{}') as Record<string, any>;

describe('OpenAiChatAdapter', () => {
  describe('buildRequest', () => {
    it('posts Chat Completions with a bearer key and the extra headers', () => {
      const built = adapter.buildRequest(target, request());
      expect(built).toMatchObject({ method: 'POST', url: 'http://localhost:8317/v1/chat/completions' });
      expect(built.headers).toMatchObject({ authorization: 'Bearer sk-client-key-123456', 'content-type': 'application/json', 'X-Extra': 'yes' });
      expect(bodyOf(built)).toMatchObject({
        model: 'gpt-6-luna',
        stream: false,
        max_tokens: 800,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Find the names.' },
          { role: 'user', content: 'It is a truth universally acknowledged...' },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'reply', schema, strict: true } },
      });
    });

    it('sends no authorization header for a keyless local runner', () => {
      expect(adapter.buildRequest({ ...target, key: null }, request()).headers.authorization).toBeUndefined();
    });

    it('asks for a non-strict schema when the schema has optional properties', () => {
      const loose = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
      expect(bodyOf(adapter.buildRequest(target, request({ schema: loose }))).response_format.json_schema.strict).toBe(false);
    });

    it('uses JSON mode with the schema in the prompt, which also gives DeepSeek the word it needs', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ json: 'json' })));
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages[0].content).toContain('JSON');
      expect(body.messages[0].content).toContain('"names"');
    });

    it('puts the schema in the prompt and asks for nothing else in instructions mode', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ json: 'instructions' })));
      expect(body.response_format).toBeUndefined();
      expect(body.messages[0].content).toMatch(/^Find the names\.\n\nReply with a single JSON object/);
    });

    it('requires parameters and reports cost on OpenRouter', () => {
      const body = bodyOf(adapter.buildRequest({ ...target, baseUrl: 'https://openrouter.ai/api/v1' }, request()));
      expect(body.provider).toEqual({ require_parameters: true });
      expect(body.usage).toEqual({ include: true });
      expect(bodyOf(adapter.buildRequest(target, request())).provider).toBeUndefined();
    });

    it('leaves out what the connection rejected before', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ omit: new Set(['max_tokens', 'temperature', 'response_format']) })));
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(800);
      expect(body.temperature).toBeUndefined();
      expect(body.response_format).toBeUndefined();
      expect(body.messages[0].content).toContain('JSON schema');
    });

    it('sends reasoning_effort only when effort is asked', () => {
      expect(bodyOf(adapter.buildRequest(target, request({ effort: 'medium' }))).reasoning_effort).toBe('medium');
      expect(bodyOf(adapter.buildRequest(target, request())).reasoning_effort).toBeUndefined();
    });

    it('leaves effort out where OpenRouter must match every parameter', () => {
      const router = { ...target, baseUrl: 'https://openrouter.ai/api/v1' };
      expect(bodyOf(adapter.buildRequest(router, request({ effort: 'medium' }))).reasoning_effort).toBeUndefined();
      expect(bodyOf(adapter.buildRequest(router, request({ effort: 'medium', json: 'json' }))).reasoning_effort).toBe('medium');
      const unfiltered = request({ effort: 'medium', omit: new Set(['provider']) });
      expect(bodyOf(adapter.buildRequest(router, unfiltered)).reasoning_effort).toBe('medium');
    });

    it('sends a level the slot chose to OpenRouter as reasoning, which every provider it picks must take', () => {
      const router = { ...target, baseUrl: 'https://openrouter.ai/api/v1' };
      const body = bodyOf(adapter.buildRequest(router, request({ effort: 'xhigh', effortChosen: true })));
      expect(body.reasoning).toEqual({ effort: 'xhigh' });
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.provider).toEqual({ require_parameters: true });
      expect(bodyOf(adapter.buildRequest(target, request({ effort: 'xhigh', effortChosen: true }))).reasoning_effort).toBe('xhigh');
    });

    it('drops reasoning_effort once it was rejected', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'medium', omit: new Set(['reasoning_effort']) })));
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.response_format).toMatchObject({ type: 'json_schema' });
    });
  });

  describe('parseResponse', () => {
    it('reads text, usage with cached and reasoning tokens, and the reported model', () => {
      expect(adapter.parseResponse(fixture('success'))).toEqual({
        text: 'Elizabeth Bennet is the second of five daughters.',
        finish: 'stop',
        usage: { input: 412, output: 38, reasoning: 0, cached: 128 },
        usageReported: true,
        model: 'gpt-6-luna-2026-10-01',
      });
    });

    it('reads a schema reply as text for the client to validate', () => {
      expect(adapter.parseResponse(fixture('schema'))).toMatchObject({
        text: '{"names":[{"name":"Elizabeth Bennet","kind":"person"}]}',
        usage: { reasoning: 24 },
      });
      expect(adapter.parseResponse(fixture('json-mode'))?.text).toContain('```json');
    });

    it('normalises length, refusal and filter', () => {
      expect(adapter.parseResponse(fixture('length'))?.finish).toBe('length');
      expect(adapter.parseResponse(fixture('refusal'))).toMatchObject({ finish: 'refused', text: '' });
      expect(adapter.parseResponse(fixture('filtered'))?.finish).toBe('filtered');
    });

    it("prefers OpenRouter's own cost", () => {
      expect(adapter.parseResponse(fixture('openrouter-cost'))?.usage).toEqual({ input: 500, output: 60, reasoning: 10, cached: 0, cost: 0.00008 });
    });

    it('returns null for a body that is not a reply, such as a web page', () => {
      expect(adapter.parseResponse(fixture('web-page'))).toBeNull();
    });
  });

  describe('parseError', () => {
    it.each([
      ['rejected-parameter', { kind: 'bad-parameter', parameter: 'max_tokens', status: 400 }],
      ['rejected-temperature', { kind: 'bad-parameter', parameter: 'temperature' }],
      ['rejected-effort', { kind: 'bad-parameter', parameter: 'reasoning_effort', status: 400 }],
      ['unrecognized-argument', { kind: 'bad-parameter', parameter: 'reasoning_effort', status: 400 }],
      ['unauthorized', { kind: 'auth', status: 401 }],
      ['model-missing', { kind: 'model-missing', status: 404 }],
      ['rate-limited', { kind: 'rate-limited', retryAfterSeconds: 40 }],
      ['out-of-credit', { kind: 'credit', status: 402 }],
      ['context-length', { kind: 'context-length' }],
      ['server-error', { kind: 'server', status: 503 }],
      ['web-page', { kind: 'not-api' }],
    ])('%s', (name, expected) => {
      expect(adapter.parseError(fixture(name))).toMatchObject(expected);
    });

    it.each([
      'Invalid reasoning_effort: minimal. Valid values are low, medium, high.',
      'Model grok-5 does not support parameter reasoningEffort.',
      '"gemma4" does not support thinking',
    ])('reads a refused effort worded as %s', (message) => {
      const text = JSON.stringify({ error: { message, type: 'invalid_request_error', param: null, code: null } });
      const response = { status: 400, headers: new Headers({ 'content-type': 'application/json' }), text, durationMs: 1 };
      expect(adapter.parseError(response)).toMatchObject({ kind: 'bad-parameter', parameter: 'reasoning_effort' });
    });

    it('tells a missing endpoint from a missing model', () => {
      const response = { status: 404, headers: new Headers({ 'content-type': 'text/plain' }), text: '404 page not found', durationMs: 1 };
      expect(adapter.parseError(response).kind).toBe('endpoint-missing');
    });

    it('retries a proxy that timed out on a dropped reply stream', () => {
      const text = '{"error":{"message":"stream error: stream disconnected before completion","type":"invalid_request_error"}}';
      const response = { status: 408, headers: new Headers({ 'content-type': 'application/json' }), text, durationMs: 1 };
      expect(adapter.parseError(response).kind).toBe('server');
    });
  });

  describe('listModels', () => {
    const sendFixture = (name: string) => vi.fn<(req: AiHttpRequest) => Promise<ReturnType<typeof fixture>>>(() => Promise.resolve(fixture(name)));

    it('reads { data: [...] }', async () => {
      const send = sendFixture('models');
      await expect(adapter.listModels(target, send)).resolves.toEqual({ listed: true, models: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-terra' }] });
      expect(send.mock.calls[0][0]).toMatchObject({ method: 'GET', url: 'http://localhost:8317/v1/models' });
    });

    it("reads OpenRouter's prices per million and context", async () => {
      const list = await adapter.listModels(target, sendFixture('models-openrouter'));
      expect(list.models[0]).toEqual({
        id: 'openai/gpt-6-luna',
        name: 'OpenAI: GPT-6 Luna',
        contextLength: 400000,
        maxOutputTokens: 128000,
        prices: { input: 0.1, output: 0.5 },
      });
      expect(list.models[1].prices).toEqual({ input: 3, output: 15 });
    });

    it('reads a bare array', async () => {
      await expect(adapter.listModels(target, sendFixture('models-bare-array'))).resolves.toMatchObject({
        listed: true,
        models: [{ id: 'meta-llama/Llama-4-Scout', contextLength: 327680 }, { id: 'Qwen/Qwen3-235B' }],
      });
    });

    it('treats an empty or missing list as a typed model', async () => {
      await expect(adapter.listModels(target, sendFixture('models-empty'))).resolves.toEqual({ listed: false, models: [] });
      const missing = vi.fn(() => Promise.resolve({ status: 404, headers: new Headers(), text: '', durationMs: 1 }));
      await expect(adapter.listModels(target, missing)).resolves.toEqual({ listed: false, models: [] });
    });

    it('throws a rejected key', async () => {
      const error = await adapter.listModels(target, sendFixture('unauthorized')).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(AiProviderFailure);
      expect((error as AiProviderFailure).error.kind).toBe('auth');
    });
  });

  it("checks the key with OpenRouter's key route only", async () => {
    const send = vi.fn(() => Promise.resolve({ status: 401, headers: new Headers(), text: '{}', durationMs: 1 }));
    await expect(adapter.checkKey({ ...target, baseUrl: 'https://openrouter.ai/api/v1' }, send)).resolves.toBe(false);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://openrouter.ai/api/v1/key' }));
    await expect(adapter.checkKey(target, send)).resolves.toBeNull();
  });
});
