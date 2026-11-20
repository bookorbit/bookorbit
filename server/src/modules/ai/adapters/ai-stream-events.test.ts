import type { AiAdapterRequest } from './ai-adapter.interface';
import { AnthropicMessagesAdapter } from './anthropic-messages.adapter';
import { OpenAiChatAdapter } from './openai-chat.adapter';
import { OpenAiResponsesAdapter } from './openai-responses.adapter';

const target = { baseUrl: 'http://localhost:8317/v1', key: 'sk-stream-test-key-0001', headers: [] };
const request = (overrides: Partial<AiAdapterRequest> = {}): AiAdapterRequest => ({
  model: 'model-x',
  system: 'Answer briefly.',
  messages: [{ role: 'user', content: 'Who is Mr Darcy?' }],
  json: 'none',
  maxOutputTokens: 2_000,
  omit: new Set(),
  stream: true,
  ...overrides,
});
const bodyOf = (built: { body?: string }) => JSON.parse(built.body ?? '{}') as Record<string, unknown>;
const data = (value: unknown) => ({ data: JSON.stringify(value) });

describe('OpenAI Chat streaming', () => {
  const adapter = new OpenAiChatAdapter();

  it('asks for a stream with usage at the end, unless the server refused stream_options', () => {
    expect(bodyOf(adapter.buildRequest(target, request()))).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    const omitted = bodyOf(adapter.buildRequest(target, request({ omit: new Set(['stream_options']) })));
    expect(omitted.stream).toBe(true);
    expect(omitted).not.toHaveProperty('stream_options');
    expect(bodyOf(adapter.buildRequest(target, request({ stream: undefined })))).toMatchObject({ stream: false });
  });

  it('reads text, the finish, the model, usage and the end', () => {
    expect(adapter.parseStreamEvent(data({ model: 'model-x-2026', choices: [{ delta: { role: 'assistant', content: 'Mr ' } }] }))).toEqual({
      model: 'model-x-2026',
      delta: 'Mr ',
    });
    expect(adapter.parseStreamEvent(data({ choices: [{ delta: {}, finish_reason: 'length' }] }))).toEqual({ finish: 'length' });
    expect(adapter.parseStreamEvent(data({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40 } }))?.usage).toMatchObject({
      input: 900,
      output: 40,
    });
    expect(adapter.parseStreamEvent({ data: '[DONE]' })).toEqual({ end: true });
  });

  it('marks a refusal and maps a mid-stream error', () => {
    expect(adapter.parseStreamEvent(data({ choices: [{ delta: { refusal: 'I cannot help with that.' } }] }))).toEqual({ finish: 'refused' });
    expect(adapter.parseStreamEvent(data({ error: { message: 'Rate limit reached', code: 429 } }))?.error).toMatchObject({
      kind: 'rate-limited',
      status: 429,
    });
    expect(adapter.parseStreamEvent({ data: 'not json' })).toBeNull();
  });
});

describe('Anthropic Messages streaming', () => {
  const adapter = new AnthropicMessagesAdapter();

  it('asks for a stream only when streaming', () => {
    expect(bodyOf(adapter.buildRequest(target, request()))).toMatchObject({ stream: true });
    expect(bodyOf(adapter.buildRequest(target, request({ stream: undefined })))).not.toHaveProperty('stream');
  });

  it('reads the model and input usage at the start, text deltas, the stop reason and the end', () => {
    expect(
      adapter.parseStreamEvent(data({ type: 'message_start', message: { model: 'claude-model', usage: { input_tokens: 1200, output_tokens: 1 } } })),
    ).toMatchObject({ model: 'claude-model', usage: { input: 1200, output: 1 } });
    expect(adapter.parseStreamEvent(data({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Darcy' } }))).toEqual({
      delta: 'Darcy',
    });
    expect(adapter.parseStreamEvent(data({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '...' } }))).toBeNull();
    expect(
      adapter.parseStreamEvent(data({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 80 } })),
    ).toMatchObject({
      finish: 'length',
      usage: { output: 80 },
    });
    expect(adapter.parseStreamEvent(data({ type: 'message_stop' }))).toEqual({ end: true });
    expect(adapter.parseStreamEvent(data({ type: 'ping' }))).toBeNull();
  });

  it('maps an error event', () => {
    expect(adapter.parseStreamEvent(data({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))?.error).toMatchObject({
      kind: 'server',
    });
  });
});

describe('OpenAI Responses streaming', () => {
  const adapter = new OpenAiResponsesAdapter();

  it('asks for a stream only when streaming', () => {
    expect(bodyOf(adapter.buildRequest(target, request()))).toMatchObject({ stream: true });
    expect(bodyOf(adapter.buildRequest(target, request({ stream: undefined })))).not.toHaveProperty('stream');
  });

  it('reads text deltas, the model and the completed response', () => {
    expect(adapter.parseStreamEvent(data({ type: 'response.created', response: { model: 'gpt-model' } }))).toEqual({ model: 'gpt-model' });
    expect(adapter.parseStreamEvent(data({ type: 'response.output_text.delta', delta: 'Elizabeth' }))).toEqual({ delta: 'Elizabeth' });
    const completed = adapter.parseStreamEvent(
      data({ type: 'response.completed', response: { model: 'gpt-model', status: 'completed', usage: { input_tokens: 500, output_tokens: 30 } } }),
    );
    expect(completed).toMatchObject({ model: 'gpt-model', finish: 'stop', end: true, usage: { input: 500, output: 30 } });
  });

  it('marks a refusal and maps a failed response', () => {
    expect(adapter.parseStreamEvent(data({ type: 'response.refusal.delta', delta: 'No.' }))).toEqual({ finish: 'refused' });
    expect(
      adapter.parseStreamEvent(
        data({ type: 'response.failed', response: { error: { message: 'Your input exceeds the context window of this model' } } }),
      )?.error,
    ).toMatchObject({ kind: 'context-length' });
  });
});
