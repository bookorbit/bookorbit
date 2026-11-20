import type { NewAiUsageRow } from '../../db/schema';
import type { AiBudgetService } from './ai-budget.service';
import { AiClient, type AiStreamEvent, type AiStreamOptions } from './ai-client.service';
import { AiError, type AiRequest, type AiResult } from './ai-client.types';
import type { AiConnectionService, ResolvedAiConnection } from './ai-connection.service';
import { AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import type { AiLedgerRepository } from './ai-ledger.repository';
import { AiLimiterService } from './ai-limiter';
import type { AiHttpOptions, AiHttpRequest, AiHttpResponse, AiHttpService, AiHttpStream } from './ai-network';
import { defaultFeatureSettings, emptySlot, type AiSettingsService, type AiSettingsSnapshot } from './ai-settings.service';

type Opened = AiHttpStream | ({ kind: 'whole' } & AiHttpResponse);

const conn = {
  id: 1,
  name: 'Proxy',
  apiType: 'openai-chat',
  baseUrl: 'http://localhost:8317/v1',
  key: 'sk-stream-client-key-0000a1',
  headers: [],
  networkProfile: null,
  timeoutMs: 120_000,
  maxParallel: 8,
  requestsPerMinute: null,
  jsonSupport: 'schema',
} as unknown as ResolvedAiConnection & { id: number };

/** An SSE body that sends `chunks`, then ends, or stays open when `stall` is set. */
function sse(chunks: string[], options: { stall?: boolean; onCancel?: () => void } = {}): Opened {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else if (!options.stall) controller.close();
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return { kind: 'stream', status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body, durationMs: 10 };
}

const chunk = (content: string) => `data: ${JSON.stringify({ model: 'gpt-6-luna-2026', choices: [{ delta: { content } }] })}\n\n`;
const finish = (reason = 'stop') => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
const usage = (input: number, output: number) =>
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } })}\n\n`;
const DONE = 'data: [DONE]\n\n';

function whole(status: number, body: unknown = { error: { message: 'Service unavailable' } }): Opened {
  return { kind: 'whole', status, headers: new Headers({ 'content-type': 'application/json' }), text: JSON.stringify(body), durationMs: 5 };
}

function setup(options: { careful?: boolean } = {}) {
  const slot = { ...emptySlot(), connectionId: conn.id, model: 'gpt-6-luna', prices: { input: 1, output: 4 }, maxOutputTokens: null };
  const snapshot: AiSettingsSnapshot = {
    slots: { fast: slot, careful: options.careful === false ? emptySlot() : { ...slot }, vision: { ...slot } },
    slotHealth: {},
    features: {
      'story-guides': { ...defaultFeatureSettings('story-guides'), enabled: true },
      'vision-scan': { ...defaultFeatureSettings('vision-scan'), enabled: true },
      'reading-help': { ...defaultFeatureSettings('reading-help'), enabled: true },
    },
    budget: { monthlyBudget: null, buildsPerMonth: null },
    privacy: {},
  };
  const settings = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(snapshot))),
    slots: vi.fn(() => Promise.resolve(structuredClone(snapshot.slots))),
    setSlotHealth: vi.fn(() => Promise.resolve()),
  };
  const connections = { resolve: vi.fn(() => Promise.resolve(conn)), markFailing: vi.fn(() => Promise.resolve()) };
  const rows: NewAiUsageRow[] = [];
  const ledger = { insert: vi.fn((row: NewAiUsageRow) => Promise.resolve(void rows.push(row))) };
  const budget = { checkRequest: vi.fn(() => Promise.resolve()) };
  const sent: AiHttpRequest[] = [];
  let replies: (() => Opened)[] = [];
  const http = {
    open: vi.fn<(request: AiHttpRequest, options: AiHttpOptions) => Promise<Opened>>((request) => {
      sent.push(request);
      const next = replies[Math.min(sent.length, replies.length) - 1];
      return Promise.resolve(next());
    }),
  };
  const client = new AiClient(
    connections as unknown as AiConnectionService,
    settings as unknown as AiSettingsService,
    budget as unknown as AiBudgetService,
    ledger as unknown as AiLedgerRepository,
    new AiLimiterService(),
    http as unknown as AiHttpService,
    new AiJobsBridge(),
    new AiEventsService(),
  );
  client.streamRetryDelaysMs = [1];
  return { client, snapshot, rows, sent, http, connections, budget, reply: (...next: (() => Opened)[]) => (replies = next) };
}

const request = (overrides: Partial<AiRequest> = {}): AiRequest => ({
  feature: 'reading-help',
  slot: 'fast',
  system: 'Answer briefly.',
  user: 'Who is Mr Darcy?',
  maxOutputTokens: 2_000,
  effort: 'low',
  userId: 7,
  ...overrides,
});

async function drain(stream: AsyncGenerator<AiStreamEvent, void, undefined>): Promise<{ deltas: string[]; done: AiResult | null }> {
  const deltas: string[] = [];
  let done: AiResult | null = null;
  for await (const event of stream) {
    if ('delta' in event) deltas.push(event.delta);
    else done = event.done;
  }
  return { deltas, done };
}

const run = (client: AiClient, overrides: Partial<AiRequest> = {}, options?: AiStreamOptions) => drain(client.stream(request(overrides), options));

describe('AiClient.stream', () => {
  it('streams the text, then records the reported usage against the reader', async () => {
    const t = setup();
    t.reply(() => sse([chunk('Mr Darcy '), chunk('is proud.'), finish(), usage(900, 12), DONE]));
    const { deltas, done } = await run(t.client);

    expect(deltas).toEqual(['Mr Darcy ', 'is proud.']);
    expect(done).toMatchObject({ text: 'Mr Darcy is proud.', finish: 'stop', model: 'gpt-6-luna-2026', usage: { input: 900, output: 12 } });
    expect(JSON.parse(t.sent[0].body ?? '{}')).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ feature: 'reading-help', outcome: 'ok', userId: 7, inputTokens: 900, outputTokens: 12 });
  });

  it('sends the level the slot chose over the one the feature asks for', async () => {
    const t = setup();
    t.reply(() => sse([chunk('Yes.'), finish(), usage(10, 1), DONE]));
    await run(t.client);
    t.snapshot.slots.fast.effort = 'high';
    await run(t.client);
    expect(t.sent.map((sent) => (JSON.parse(sent.body ?? '{}') as { reasoning_effort?: string }).reasoning_effort)).toEqual(['low', 'high']);
  });

  it('retries once when the provider fails before the first piece of text', async () => {
    const t = setup();
    t.reply(
      () => whole(503),
      () => sse([chunk('Elizabeth.'), finish(), DONE]),
    );
    const { done } = await run(t.client);
    expect(done?.text).toBe('Elizabeth.');
    expect(t.http.open).toHaveBeenCalledTimes(2);
    expect(t.rows.map((row) => row.outcome)).toEqual(['error:provider-down', 'ok']);
  });

  it('gives up after the one retry, without marking the connection failing', async () => {
    const t = setup();
    t.reply(() => whole(503));
    const error = await run(t.client).catch((err: unknown) => err as AiError);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('provider-down');
    expect(t.http.open).toHaveBeenCalledTimes(2);
    expect(t.connections.markFailing).not.toHaveBeenCalled();
  });

  it('does not retry a failure after text has been sent, and records what came back', async () => {
    const t = setup();
    t.reply(() => sse([chunk('Mr Darcy '), `data: ${JSON.stringify({ error: { message: 'Upstream reset', code: 502 } })}\n\n`]));
    const deltas: string[] = [];
    const error = await (async () => {
      for await (const event of t.client.stream(request())) if ('delta' in event) deltas.push(event.delta);
    })().catch((err: unknown) => err as AiError);

    expect(deltas).toEqual(['Mr Darcy ']);
    expect((error as AiError).code).toBe('provider-down');
    expect(t.http.open).toHaveBeenCalledTimes(1);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ outcome: 'error:provider-down', userId: 7 });
    expect(t.rows[0].outputTokens).toBeGreaterThan(0);
  });

  it('stops reading when the caller has enough, and records an estimate', async () => {
    const t = setup();
    let cancelled = false;
    t.reply(() => sse([chunk('One. '), chunk('Two. '), chunk('Three.')], { stall: true, onCancel: () => (cancelled = true) }));
    const { deltas, done } = await run(t.client, {}, { stopWhen: (text) => text.includes('Two.') });

    expect(deltas).toEqual(['One. ', 'Two. ']);
    expect(done).toMatchObject({ text: 'One. Two. ', finish: 'stop' });
    expect(cancelled).toBe(true);
    expect(t.rows[0]).toMatchObject({ outcome: 'ok' });
    expect(t.rows[0].inputTokens).toBeGreaterThan(0);
  });

  it('records an abandoned stream as cancelled', async () => {
    const t = setup();
    t.reply(() => sse([chunk('One. '), chunk('Two. ')], { stall: true }));
    for await (const event of t.client.stream(request())) {
      expect(event).toEqual({ delta: 'One. ' });
      break;
    }
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ outcome: 'error:cancelled', userId: 7 });
  });

  it('reports a refusal with no text', async () => {
    const t = setup();
    t.reply(() => sse([`data: ${JSON.stringify({ choices: [{ delta: { refusal: 'I cannot help with that.' } }] })}\n\n`, finish('stop'), DONE]));
    const { done } = await run(t.client);
    expect(done).toMatchObject({ text: '', finish: 'refused' });
    expect(t.rows[0]).toMatchObject({ outcome: 'refused' });
  });

  it('streams a provider that answered with a whole reply as one piece', async () => {
    const t = setup();
    t.reply(() =>
      whole(200, {
        model: 'gpt-6-luna',
        choices: [{ message: { role: 'assistant', content: 'Jane.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 2 },
      }),
    );
    const { deltas, done } = await run(t.client);
    expect(deltas).toEqual(['Jane.']);
    expect(done?.text).toBe('Jane.');
  });

  it('refuses a request for JSON or images, and a feature that is off', async () => {
    const t = setup();
    await expect(run(t.client, { schema: { type: 'object' } })).rejects.toThrow(/plain text/);
    const off = setup();
    off.client['settings'].snapshot = vi.fn(() =>
      Promise.resolve({
        slots: { fast: emptySlot(), careful: emptySlot(), vision: emptySlot() },
        slotHealth: {},
        features: {
          'story-guides': defaultFeatureSettings('story-guides'),
          'vision-scan': defaultFeatureSettings('vision-scan'),
          'reading-help': { ...defaultFeatureSettings('reading-help'), enabled: false },
        },
        budget: { monthlyBudget: null, buildsPerMonth: null },
        privacy: {},
      } as AiSettingsSnapshot),
    );
    const error = await run(off.client).catch((err: unknown) => err as AiError);
    expect((error as AiError).code).toBe('off');
  });
});
