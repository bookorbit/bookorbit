import type { AiHttpRequest, AiHttpResponse } from '../ai-network';
import type { AiAdapterRequest, AiAdapterTarget } from './ai-adapter.interface';
import { loadFixture } from './fixtures/load-fixture';
import { OpenAiResponsesAdapter } from './openai-responses.adapter';

const adapter = new OpenAiResponsesAdapter();
const fixture = (name: string) => loadFixture('openai-responses', name);

const target: AiAdapterTarget = { baseUrl: 'https://api.openai.com/v1', key: 'sk-proj-test-key-3f9a', headers: [] };
const schema = {
  type: 'object',
  properties: { names: { type: 'array', items: { type: 'string' } } },
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

describe('OpenAiResponsesAdapter', () => {
  describe('buildRequest', () => {
    it('posts to /responses with instructions, input, max_output_tokens and text.format', () => {
      const built = adapter.buildRequest(target, request());
      expect(built).toMatchObject({
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        headers: { authorization: 'Bearer sk-proj-test-key-3f9a' },
      });
      expect(bodyOf(built)).toEqual({
        model: 'gpt-6-luna',
        instructions: 'Find the names.',
        input: [{ role: 'user', content: 'It is a truth universally acknowledged...' }],
        max_output_tokens: 800,
        store: false,
        text: { format: { type: 'json_schema', name: 'reply', schema, strict: true } },
      });
    });

    it('sends no temperature, which reasoning models reject', () => {
      expect(bodyOf(adapter.buildRequest(target, request())).temperature).toBeUndefined();
    });

    it('uses JSON mode with the schema in the instructions', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ json: 'json' })));
      expect(body.text).toEqual({ format: { type: 'json_object' } });
      expect(body.instructions).toContain('JSON schema');
    });

    it('falls back to instructions once text.format was rejected, and drops rejected parameters', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ omit: new Set(['text', 'max_output_tokens', 'store']) })));
      expect(body.text).toBeUndefined();
      expect(body.max_output_tokens).toBeUndefined();
      expect(body.store).toBeUndefined();
      expect(body.instructions).toContain('JSON schema');
    });

    it('sends reasoning.effort only when effort is asked', () => {
      expect(bodyOf(adapter.buildRequest(target, request({ effort: 'medium' }))).reasoning).toEqual({ effort: 'medium' });
      expect(bodyOf(adapter.buildRequest(target, request())).reasoning).toBeUndefined();
    });

    it('drops reasoning once it was rejected', () => {
      const body = bodyOf(adapter.buildRequest(target, request({ effort: 'medium', omit: new Set(['reasoning']) })));
      expect(body.reasoning).toBeUndefined();
      expect(body.text).toMatchObject({ format: { type: 'json_schema' } });
    });
  });

  describe('parseResponse', () => {
    it('reads the output text from the message items, skipping reasoning items', () => {
      expect(adapter.parseResponse(fixture('success'))).toEqual({
        text: 'Elizabeth Bennet is the second of five daughters.',
        finish: 'stop',
        usage: { input: 430, output: 96, reasoning: 58, cached: 0 },
        usageReported: true,
        model: 'gpt-6-luna-2026-10-01',
      });
      expect(adapter.parseResponse(fixture('schema'))?.text).toBe('{"names":[{"name":"Elizabeth Bennet","kind":"person"}]}');
      expect(adapter.parseResponse(fixture('json-mode'))?.finish).toBe('stop');
    });

    it('normalises an incomplete reply, a refusal and a filter', () => {
      expect(adapter.parseResponse(fixture('length'))?.finish).toBe('length');
      expect(adapter.parseResponse(fixture('refusal'))).toMatchObject({ finish: 'refused', text: '' });
      expect(adapter.parseResponse(fixture('filtered'))?.finish).toBe('filtered');
    });
  });

  describe('parseError', () => {
    it.each([
      ['rejected-parameter', { kind: 'bad-parameter', parameter: 'temperature', status: 400 }],
      ['rejected-effort', { kind: 'bad-parameter', parameter: 'reasoning', status: 400 }],
      ['reasoning-unsupported', { kind: 'bad-parameter', parameter: 'reasoning', status: 400 }],
      ['unauthorized', { kind: 'auth', status: 401 }],
      ['model-missing', { kind: 'model-missing', status: 404 }],
      ['rate-limited', { kind: 'rate-limited', retryAfterSeconds: 40 }],
      ['out-of-credit', { kind: 'credit', status: 429 }],
    ])('%s', (name, expected) => {
      expect(adapter.parseError(fixture(name))).toMatchObject(expected);
    });
  });

  it('lists models', async () => {
    const send = vi.fn<(req: AiHttpRequest) => Promise<AiHttpResponse>>(() => Promise.resolve(fixture('models')));
    await expect(adapter.listModels(target, send)).resolves.toEqual({ listed: true, models: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-terra' }] });
    expect(send.mock.calls[0][0]).toMatchObject({
      url: 'https://api.openai.com/v1/models',
      headers: { authorization: 'Bearer sk-proj-test-key-3f9a' },
    });
  });
});
