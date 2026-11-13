import type { AiHttpRequest, AiHttpResponse } from '../ai-network';
import type { AiAdapterRequest, AiAdapterTarget } from './ai-adapter.interface';
import { AnthropicMessagesAdapter } from './anthropic-messages.adapter';
import { loadFixture } from './fixtures/load-fixture';

const adapter = new AnthropicMessagesAdapter();
const fixture = (name: string) => loadFixture('anthropic-messages', name);

const target: AiAdapterTarget = { baseUrl: 'https://api.anthropic.com', key: 'sk-ant-api03-test-key-0000', headers: [] };
const schema = {
  type: 'object',
  properties: {
    names: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: { type: 'object', properties: { name: { type: 'string', maxLength: 80 } }, required: ['name'] },
    },
    count: { type: 'integer', minimum: 0 },
  },
  required: ['names'],
};
const request = (overrides: Partial<AiAdapterRequest> = {}): AiAdapterRequest => ({
  model: 'claude-sonnet-5-5',
  system: 'Find the names.',
  messages: [{ role: 'user', content: 'It is a truth universally acknowledged...' }],
  json: 'schema',
  schema,
  maxOutputTokens: 800,
  omit: new Set(),
  ...overrides,
});
const bodyOf = (built: AiHttpRequest) => JSON.parse(built.body ?? '{}') as Record<string, any>;

describe('AnthropicMessagesAdapter', () => {
  describe('buildRequest', () => {
    it('posts to /v1/messages with x-api-key and the API version', () => {
      const built = adapter.buildRequest(target, request());
      expect(built).toMatchObject({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' });
      expect(built.headers).toMatchObject({ 'x-api-key': 'sk-ant-api03-test-key-0000', 'anthropic-version': '2023-06-01' });
      expect(built.headers.authorization).toBeUndefined();
    });

    it('also sends the key as a bearer token to proxies serving Messages', () => {
      const built = adapter.buildRequest({ ...target, baseUrl: 'http://localhost:8317', key: 'sk-client-1234567' }, request());
      expect(built.url).toBe('http://localhost:8317/v1/messages');
      expect(built.headers).toMatchObject({ 'x-api-key': 'sk-client-1234567', authorization: 'Bearer sk-client-1234567' });
    });

    it('never sends temperature or top_p, and enforces the schema stripped of constraints', () => {
      const body = bodyOf(adapter.buildRequest(target, request()));
      expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 800, system: 'Find the names.' });
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      expect(body.output_config).toEqual({
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              names: {
                type: 'array',
                items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
              },
              count: { type: 'integer' },
            },
            required: ['names'],
            additionalProperties: false,
          },
        },
      });
    });

    it('has no JSON mode of its own, so JSON mode and instructions put the schema in the prompt', () => {
      for (const json of ['json', 'instructions'] as const) {
        const body = bodyOf(adapter.buildRequest(target, request({ json })));
        expect(body.output_config).toBeUndefined();
        expect(body.system).toContain('JSON schema');
      }
    });

    it('falls back to instructions once output_config was rejected', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ omit: new Set(['output_config']) })));
      expect(body.output_config).toBeUndefined();
      expect(body.system).toContain('"maxItems":50');
    });

    it('sends effort in output_config beside the schema format', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'medium' })));
      expect(body.output_config.effort).toBe('medium');
      expect(body.output_config.format).toMatchObject({ type: 'json_schema' });
      expect(body.effort).toBeUndefined();
    });

    it('sends effort alone in output_config when the reply is plain text', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ json: 'none', schema: undefined, effort: 'high' })));
      expect(body.output_config).toEqual({ effort: 'high' });
    });

    it('sends no effort when none is asked', () => {
      expect(bodyOf(adapter.buildRequest(target, request())).output_config.effort).toBeUndefined();
      expect(bodyOf(adapter.buildRequest(target, request({ json: 'none', schema: undefined }))).output_config).toBeUndefined();
    });

    it('drops only effort once it was rejected, keeping the schema format', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'medium', omit: new Set(['output_config.effort']) })));
      expect(body.output_config).toEqual({ format: expect.objectContaining({ type: 'json_schema' }) });
      const plain = bodyOf(
        adapter.buildRequest(target, request({ json: 'none', schema: undefined, effort: 'medium', omit: new Set(['output_config.effort']) })),
      );
      expect(plain.output_config).toBeUndefined();
    });

    it('drops effort with the rest of output_config once output_config was rejected', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'medium', omit: new Set(['output_config']) })));
      expect(body.output_config).toBeUndefined();
    });

    it('still sends an effort the slot chose after output_config was rejected, in instructions mode', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'high', effortChosen: true, omit: new Set(['output_config']) })));
      expect(body.output_config).toEqual({ effort: 'high' });
      expect(body.system).toContain('JSON schema');
    });
  });

  describe('parseResponse', () => {
    it('reads text blocks and usage with cache reads counted as cached input', () => {
      expect(adapter.parseResponse(fixture('success'))).toEqual({
        text: 'Elizabeth Bennet is the second of five daughters.',
        finish: 'stop',
        usage: { input: 518, output: 44, reasoning: 0, cached: 120 },
        usageReported: true,
        model: 'claude-sonnet-5-5',
      });
      expect(adapter.parseResponse(fixture('schema'))?.text).toBe('{"names":[{"name":"Elizabeth Bennet","kind":"person"}]}');
      expect(adapter.parseResponse(fixture('json-mode'))?.text).toMatch(/^Here is the JSON/);
    });

    it('normalises max_tokens and refusal', () => {
      expect(adapter.parseResponse(fixture('length'))?.finish).toBe('length');
      expect(adapter.parseResponse(fixture('refusal'))).toMatchObject({ finish: 'refused', text: '' });
    });
  });

  describe('parseError', () => {
    it.each([
      ['rejected-parameter', { kind: 'bad-parameter', parameter: 'output_config', status: 400 }],
      ['rejected-temperature', { kind: 'bad-parameter', parameter: 'temperature' }],
      ['rejected-effort', { kind: 'bad-parameter', parameter: 'output_config.effort', status: 400 }],
      ['effort-unsupported', { kind: 'bad-parameter', parameter: 'output_config.effort', status: 400 }],
      ['unauthorized', { kind: 'auth', status: 401 }],
      ['model-missing', { kind: 'model-missing', status: 404 }],
      ['rate-limited', { kind: 'rate-limited', retryAfterSeconds: 40 }],
      ['spend-limit', { kind: 'spend-limit', status: 429 }],
      ['out-of-credit', { kind: 'credit' }],
      ['overloaded', { kind: 'server', status: 529 }],
      ['context-length', { kind: 'context-length' }],
    ])('%s', (name, expected) => {
      expect(adapter.parseError(fixture(name))).toMatchObject(expected);
    });

    it('retries a request timeout', () => {
      const response = {
        status: 408,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: '{"type":"error","error":{"type":"timeout_error","message":"Request timed out"}}',
        durationMs: 1,
      };
      expect(adapter.parseError(response).kind).toBe('server');
    });
  });

  it('pages through the model list with capability data', async () => {
    const pages = [fixture('models-page-1'), fixture('models-page-2')];
    const send = vi.fn<(req: AiHttpRequest) => Promise<AiHttpResponse>>(() => Promise.resolve(pages.shift()!));
    await expect(adapter.listModels(target, send)).resolves.toEqual({
      listed: true,
      models: [
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', contextLength: 1000000, maxOutputTokens: 128000 },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
      ],
    });
    expect(send.mock.calls.map((call) => call[0].url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-5-5',
    ]);
    expect(send.mock.calls[0][0].headers).toMatchObject({ 'x-api-key': 'sk-ant-api03-test-key-0000', 'anthropic-version': '2023-06-01' });
  });
});
