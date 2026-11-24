import { Logger } from '@nestjs/common';

import type { NewAiUsageRow } from '../../db/schema';
import { loadFixture } from './adapters/fixtures/load-fixture';
import type { AiBudgetStore } from './ai-budget.repository';
import { AiBudgetService } from './ai-budget.service';
import { AiClient } from './ai-client.service';
import { AiError, type AiRequest } from './ai-client.types';
import type { AiConnectionService, ResolvedAiConnection } from './ai-connection.service';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import type { AiLedgerRepository } from './ai-ledger.repository';
import { AiLimiterService } from './ai-limiter';
import { AiNetworkError, type AiHttpOptions, type AiHttpRequest, type AiHttpResponse, type AiHttpService } from './ai-network';
import { defaultFeatureSettings, emptySlot, type AiSettingsService, type AiSettingsSnapshot } from './ai-settings.service';

const KEY = 'sk-proj-client-test-key-0000003f9a';
const SCHEMA = {
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
const VALID_JSON = '{"names":[{"name":"Elizabeth Bennet","kind":"person"}]}';

function connection(overrides: Partial<ResolvedAiConnection> = {}): ResolvedAiConnection & { id: number } {
  return {
    id: 1,
    name: 'Proxy',
    apiType: 'openai-chat',
    baseUrl: 'http://localhost:8317/v1',
    key: KEY,
    headers: [],
    networkProfile: null,
    timeoutMs: 120_000,
    maxParallel: 8,
    requestsPerMinute: null,
    jsonSupport: 'schema',
    ...overrides,
  } as ResolvedAiConnection & { id: number };
}

function reply(content: string, finish = 'stop', usage = { prompt_tokens: 1000, completion_tokens: 200 }): AiHttpResponse {
  return {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: JSON.stringify({ model: 'gpt-6-luna-2026-10-01', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage }),
    durationMs: 50,
  };
}

function status(code: number, headers: Record<string, string> = {}, body: unknown = { error: { message: 'Something went wrong' } }): AiHttpResponse {
  return { status: code, headers: new Headers({ 'content-type': 'application/json', ...headers }), text: JSON.stringify(body), durationMs: 5 };
}

type Responder = (request: AiHttpRequest, call: number) => AiHttpResponse | Promise<AiHttpResponse>;

function setup(
  options: {
    conn?: ResolvedAiConnection & { id: number };
    enabled?: boolean;
    slotModel?: string | null;
    prices?: boolean;
    maxOutputTokens?: number | null;
  } = {},
) {
  const conn = options.conn ?? connection();
  const slot = {
    ...emptySlot(),
    connectionId: conn.id,
    model: options.slotModel === undefined ? 'gpt-6-luna' : options.slotModel,
    prices: options.prices === false ? null : { input: 1, output: 4 },
    maxOutputTokens: options.maxOutputTokens ?? null,
  };
  const snapshot: AiSettingsSnapshot = {
    slots: { fast: slot, careful: { ...slot }, vision: { ...slot } },
    slotHealth: {},
    features: {
      'story-guides': { ...defaultFeatureSettings('story-guides'), enabled: options.enabled ?? true },
      'vision-scan': { ...defaultFeatureSettings('vision-scan'), enabled: options.enabled ?? true },
      'reading-help': { ...defaultFeatureSettings('reading-help'), enabled: options.enabled ?? true },
    },
    budget: { monthlyBudget: null, buildsPerMonth: null },
    privacy: {},
  };
  const settings = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(snapshot))),
    slots: vi.fn(() => Promise.resolve(structuredClone(snapshot.slots))),
    setSlotHealth: vi.fn((slotName: 'fast' | 'careful', health: AiSettingsSnapshot['slotHealth']['fast'] | null) => {
      if (health) snapshot.slotHealth[slotName] = health;
      else delete snapshot.slotHealth[slotName];
      return Promise.resolve();
    }),
  };
  const connections = {
    resolve: vi.fn(() => Promise.resolve(conn)),
    markFailing: vi.fn(() => Promise.resolve()),
  };
  const rows: NewAiUsageRow[] = [];
  const ledger = { insert: vi.fn((row: NewAiUsageRow) => Promise.resolve(void rows.push(row))) };
  const budget = { checkRequest: vi.fn(() => Promise.resolve()) };
  const sent: AiHttpRequest[] = [];
  let responder: Responder = () => reply(VALID_JSON);
  let inFlight = 0;
  let maxInFlight = 0;
  const http = {
    send: vi.fn<(request: AiHttpRequest, options: AiHttpOptions) => Promise<AiHttpResponse>>(async (request) => {
      sent.push(request);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await responder(request, sent.length);
      } finally {
        inFlight--;
      }
    }),
  };
  const bridge = new AiJobsBridge();
  const events = new AiEventsService();
  const limiters = new AiLimiterService();
  const client = new AiClient(
    connections as unknown as AiConnectionService,
    settings as unknown as AiSettingsService,
    budget as unknown as AiBudgetService,
    ledger as unknown as AiLedgerRepository,
    limiters,
    http as unknown as AiHttpService,
    bridge,
    events,
  );
  client.retryDelaysMs = [1, 1, 1, 1];
  return {
    client,
    snapshot,
    settings,
    connections,
    rows,
    ledger,
    budget,
    sent,
    http,
    bridge,
    events,
    limiters,
    respond: (next: Responder) => (responder = next),
    respondInOrder: (...responses: AiHttpResponse[]) => (responder = (_request, call) => responses[Math.min(call, responses.length) - 1]),
    maxInFlight: () => maxInFlight,
  };
}

const request = (overrides: Partial<AiRequest> = {}): AiRequest => ({
  feature: 'story-guides',
  slot: 'fast',
  system: 'Find the names.',
  user: 'It is a truth universally acknowledged...',
  schema: SCHEMA,
  maxOutputTokens: 800,
  jobId: 'job-1',
  ...overrides,
});
const bodyOf = (sent: AiHttpRequest) => JSON.parse(sent.body ?? '{}') as Record<string, any>;
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (err: unknown) => err as AiError,
  );

describe('AiClient', () => {
  describe('JSON', () => {
    it('returns validated JSON with usage, cost and the reported model', async () => {
      const { client, rows } = setup();
      const result = await client.complete(request());
      expect(result).toEqual({
        text: VALID_JSON,
        json: { names: [{ name: 'Elizabeth Bennet', kind: 'person' }] },
        usage: { input: 1000, output: 200, cost: 0.0018 },
        finish: 'stop',
        model: 'gpt-6-luna-2026-10-01',
      });
      expect(rows).toEqual([
        expect.objectContaining({
          feature: 'story-guides',
          slot: 'fast',
          connectionId: 1,
          model: 'gpt-6-luna',
          outcome: 'ok',
          costMicros: 1800,
          attempt: 1,
          jobId: 'job-1',
        }),
      ]);
    });

    it('reads JSON out of a fenced reply', async () => {
      const { client, respondInOrder } = setup();
      respondInOrder(loadFixture('openai-chat', 'json-mode'));
      await expect(client.complete(request())).resolves.toMatchObject({ json: { names: [{ name: 'Elizabeth Bennet' }] } });
    });

    it('retries once with the validation error appended, then succeeds', async () => {
      const { client, respondInOrder, sent, rows } = setup();
      respondInOrder(reply('{"names":[{"name":"Elizabeth Bennet"}]}'), reply(`Sure! ${VALID_JSON}`));
      await expect(client.complete(request())).resolves.toMatchObject({
        json: { names: [{ kind: 'person' }] },
        usage: { input: 2000, output: 400, cost: 0.0036 },
      });

      const messages = bodyOf(sent[1]).messages as Array<{ role: string; content: string }>;
      expect(messages.slice(1)).toEqual([
        { role: 'user', content: 'It is a truth universally acknowledged...' },
        { role: 'assistant', content: '{"names":[{"name":"Elizabeth Bennet"}]}' },
        { role: 'user', content: expect.stringContaining('$.names[0].kind is missing') },
      ]);
      expect(rows.map((row) => [row.attempt, row.outcome])).toEqual([
        [1, 'invalid-json'],
        [2, 'ok'],
      ]);
    });

    it('fails invalid-json after the one repair', async () => {
      const { client, respond, rows } = setup();
      respond(() => reply('I cannot produce JSON for this.'));
      const error = await errorOf(client.complete(request()));
      expect(error).toBeInstanceOf(AiError);
      expect(error?.code).toBe('invalid-json');
      expect(error?.details.validation).toBe('The reply did not contain a JSON object');
      expect(error?.spent).toEqual({ input: 2000, output: 400, cost: 0.0036 });
      expect(rows).toHaveLength(2);
    });

    it('returns plain text when no schema is asked', async () => {
      const { client, sent } = setup();
      const result = await client.complete(request({ schema: undefined }));
      expect(result.json).toBeUndefined();
      expect(bodyOf(sent[0]).response_format).toBeUndefined();
    });

    it("follows the connection's tested JSON support on auto, and the slot's mode otherwise", async () => {
      const auto = setup({ conn: connection({ jsonSupport: 'json' }) });
      await auto.client.complete(request());
      expect(bodyOf(auto.sent[0]).response_format).toEqual({ type: 'json_object' });

      const fixed = setup();
      fixed.snapshot.slots.fast.jsonMode = 'instructions';
      await fixed.client.complete(request());
      expect(bodyOf(fixed.sent[0]).response_format).toBeUndefined();
    });
  });

  describe('output cut short', () => {
    it('retries once with double the output allowance', async () => {
      const { client, respondInOrder, sent, rows } = setup();
      respondInOrder(reply('{"names":[', 'length'), reply(VALID_JSON));
      const result = await client.complete(request());
      expect(sent.map((entry) => bodyOf(entry).max_tokens)).toEqual([800, 1600]);
      expect(rows.map((row) => row.outcome)).toEqual(['length', 'ok']);
      expect(result.usage).toEqual({ input: 2000, output: 400, cost: 0.0036 });
    });

    it("caps the retry at the model's limit, and fails too-long when that leaves no room", async () => {
      const capped = setup({ maxOutputTokens: 1000 });
      capped.respondInOrder(reply('{', 'length'), reply(VALID_JSON));
      await capped.client.complete(request());
      expect(bodyOf(capped.sent[1]).max_tokens).toBe(1000);

      const full = setup({ maxOutputTokens: 800 });
      full.respond(() => reply('{', 'length'));
      await expect(errorOf(full.client.complete(request()))).resolves.toMatchObject({ code: 'too-long' });
      expect(full.sent).toHaveLength(1);
    });

    it('fails too-long when the doubled reply is cut short too', async () => {
      const { client, respond, rows } = setup();
      respond(() => reply('{', 'length'));
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({
        code: 'too-long',
        spent: { input: 2000, output: 400, cost: 0.0036 },
      });
      expect(rows.map((row) => row.outcome)).toEqual(['length', 'length']);
    });

    it('maps a context-length error to too-long, which features split on', async () => {
      const { client, respondInOrder } = setup();
      respondInOrder(loadFixture('openai-chat', 'context-length'));
      const error = await errorOf(client.complete(request()));
      expect(error).toMatchObject({ code: 'too-long' });
      expect(error?.spent).toBeUndefined();
    });
  });

  describe('parameters some models reject', () => {
    it('retries once without the parameter and remembers it for the connection and model', async () => {
      const { client, respondInOrder, sent } = setup();
      respondInOrder(loadFixture('openai-chat', 'rejected-parameter'), reply(VALID_JSON), reply(VALID_JSON));
      await client.complete(request());
      expect(bodyOf(sent[0]).max_tokens).toBe(800);
      expect(bodyOf(sent[1]).max_tokens).toBeUndefined();
      expect(bodyOf(sent[1]).max_completion_tokens).toBe(800);

      await client.complete(request());
      expect(sent).toHaveLength(3);
      expect(bodyOf(sent[2]).max_completion_tokens).toBe(800);
    });

    it('does not carry a rejection over to another model', async () => {
      const { client, respondInOrder, sent } = setup();
      respondInOrder(loadFixture('openai-chat', 'rejected-parameter'), reply(VALID_JSON), reply(VALID_JSON));
      await client.complete(request());
      await client.complete(request({ use: { slot: 'fast', connectionId: 1, model: 'other-model', prices: null, jsonMode: 'auto' } }));
      expect(bodyOf(sent[2]).max_tokens).toBe(800);
    });

    it('gives up as bad-request when the same parameter is rejected again', async () => {
      const { client, respond } = setup();
      respond(() => loadFixture('openai-chat', 'rejected-parameter'));
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code: 'bad-request' });
    });

    it('sends the asked effort and nothing when none is asked', async () => {
      const { client, sent } = setup();
      await client.complete(request({ effort: 'medium' }));
      await client.complete(request());
      expect(bodyOf(sent[0]).reasoning_effort).toBe('medium');
      expect(bodyOf(sent[1]).reasoning_effort).toBeUndefined();
    });

    it('answers without effort once a server refuses it, and keeps the rest of the request', async () => {
      const { client, respondInOrder, sent } = setup();
      respondInOrder(loadFixture('openai-chat', 'unrecognized-argument'), reply(VALID_JSON), reply(VALID_JSON));
      await expect(client.complete(request({ effort: 'medium' }))).resolves.toMatchObject({ json: JSON.parse(VALID_JSON) });
      expect(bodyOf(sent[0]).reasoning_effort).toBe('medium');
      expect(bodyOf(sent[1]).reasoning_effort).toBeUndefined();
      expect(bodyOf(sent[1])).toMatchObject({ max_tokens: 800, temperature: 0, response_format: { type: 'json_schema' } });

      await client.complete(request({ effort: 'medium' }));
      expect(sent).toHaveLength(3);
      expect(bodyOf(sent[2]).reasoning_effort).toBeUndefined();
    });

    it('drops only effort from output_config on Messages when a model refuses it', async () => {
      const { client, respondInOrder, sent } = setup({
        conn: connection({ apiType: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' }),
      });
      respondInOrder(loadFixture('anthropic-messages', 'rejected-effort'), loadFixture('anthropic-messages', 'schema'));
      await client.complete(request({ effort: 'medium' }));
      expect(bodyOf(sent[0]).output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
      expect(bodyOf(sent[1]).output_config.effort).toBeUndefined();
      expect(bodyOf(sent[1]).output_config.format).toMatchObject({ type: 'json_schema' });
    });

    it('sends the level the slot chose over the one the feature asked for', async () => {
      const { client, snapshot, sent } = setup();
      snapshot.slots.fast.effort = 'high';
      await client.complete(request({ effort: 'medium' }));
      await client.complete(request());
      expect(bodyOf(sent[0]).reasoning_effort).toBe('high');
      expect(bodyOf(sent[1]).reasoning_effort).toBe('high');
    });

    it('fails and marks the slot when a model refuses the level the slot chose, instead of dropping it', async () => {
      const { client, snapshot, respond, sent } = setup();
      snapshot.slots.fast.effort = 'xhigh';
      respond(() => loadFixture('openai-chat', 'rejected-effort'));
      await expect(errorOf(client.complete(request({ effort: 'medium' })))).resolves.toMatchObject({
        code: 'bad-request',
        details: { failure: 'effort-rejected' },
      });
      expect(sent).toHaveLength(1);
      expect(snapshot.slotHealth.fast).toMatchObject({ code: 'effort-rejected', model: 'gpt-6-luna' });
    });

    it('sends the level the slot chose even where a feature level was dropped for that model before', async () => {
      const { client, snapshot, respondInOrder, sent } = setup();
      respondInOrder(loadFixture('openai-chat', 'unrecognized-argument'), reply(VALID_JSON), reply(VALID_JSON));
      await client.complete(request({ effort: 'medium' }));
      snapshot.slots.fast.effort = 'low';
      await client.complete(request({ effort: 'medium' }));
      expect(bodyOf(sent[1]).reasoning_effort).toBeUndefined();
      expect(bodyOf(sent[2]).reasoning_effort).toBe('low');
    });

    it('keeps the slot healthy when a job refused a level the slot has since moved off', async () => {
      const { client, snapshot, respond } = setup();
      snapshot.slots.fast.effort = 'low';
      respond(() => loadFixture('openai-chat', 'rejected-effort'));
      const use = { slot: 'fast' as const, connectionId: 1, model: 'gpt-6-luna', prices: null, jsonMode: 'auto' as const, effort: 'max' as const };
      await expect(errorOf(client.complete(request({ use })))).resolves.toMatchObject({ details: { failure: 'effort-rejected' } });
      expect(snapshot.slotHealth.fast).toBeUndefined();
    });
  });

  describe('retries', () => {
    it('backs off on 5xx and network errors, then succeeds', async () => {
      const { client, respond, rows } = setup();
      respond((_request, call) => {
        if (call === 1) return status(503);
        if (call === 2) throw new AiNetworkError('timeout', 'The provider did not answer in time');
        return reply(VALID_JSON);
      });
      await client.complete(request());
      expect(rows.map((row) => row.outcome)).toEqual(['error:provider-down', 'timeout', 'ok']);
    });

    it('stops after five tries, marks the connection failing and reports provider-down', async () => {
      const { client, respond, rows, connections, http } = setup();
      respond(() => status(502));
      const error = await errorOf(client.complete(request()));
      expect(error).toMatchObject({ code: 'provider-down', details: { failure: 'provider-error', connectionId: 1 } });
      expect(http.send).toHaveBeenCalledTimes(5);
      expect(rows).toHaveLength(5);
      expect(connections.markFailing).toHaveBeenCalledWith(1, 'provider-error', expect.stringContaining('502'));
    });

    it('waits 5, 20, 60 and 120 seconds by default', () => {
      expect(setup().client.retryDelaysMs).toBeDefined();
      expect(new AiClient(...(Array(8).fill(null) as ConstructorParameters<typeof AiClient>)).retryDelaysMs).toEqual([
        5_000, 20_000, 60_000, 120_000,
      ]);
    });

    it.each([
      ['unauthorized', 'provider-auth', 'key-rejected'],
      ['out-of-credit', 'provider-auth', 'out-of-credit'],
      ['web-page', 'provider-down', 'web-page'],
    ] as const)('does not retry %s, which needs the admin, and marks the connection failing', async (fixture, code, failure) => {
      const { client, respondInOrder, http, connections, rows } = setup();
      respondInOrder(loadFixture('openai-chat', fixture));
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code, details: { failure } });
      expect(http.send).toHaveBeenCalledOnce();
      expect(rows).toHaveLength(1);
      expect(connections.markFailing).toHaveBeenCalledWith(1, failure, expect.any(String));
    });

    it.each([['redirect'], ['tls'], ['blocked-address']] as const)('does not retry a %s', async (failure) => {
      const { client, respond, http, connections } = setup();
      respond(() => {
        throw new AiNetworkError(failure, `failure ${failure}`);
      });
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code: 'provider-down', details: { failure } });
      expect(http.send).toHaveBeenCalledOnce();
      expect(connections.markFailing).toHaveBeenCalledWith(1, failure, `failure ${failure}`);
    });

    it('marks the slot failing when its model is gone, and clears it when the model answers again', async () => {
      const { client, respondInOrder, snapshot, events } = setup();
      const failing = vi.fn();
      const healthy = vi.fn();
      events.on(AI_EVENTS.SLOT_FAILING, failing);
      events.on(AI_EVENTS.SLOT_HEALTHY, healthy);
      respondInOrder(loadFixture('openai-chat', 'model-missing'), reply(VALID_JSON));

      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code: 'model-missing' });
      expect(snapshot.slotHealth.fast).toMatchObject({ code: 'model-missing', model: 'gpt-6-luna', reason: 'Model no longer available' });
      expect(failing).toHaveBeenCalledWith({ slot: 'fast', model: 'gpt-6-luna', code: 'model-missing' });

      await client.complete(request());
      expect(snapshot.slotHealth.fast).toBeUndefined();
      expect(healthy).toHaveBeenCalledWith({ slot: 'fast' });
    });

    it("leaves the slot alone when a job's older model is gone after the slot moved on", async () => {
      const { client, respondInOrder, snapshot } = setup();
      respondInOrder(loadFixture('openai-chat', 'model-missing'));
      const use = { slot: 'fast' as const, connectionId: 1, model: 'retired-model', prices: null, jsonMode: 'auto' as const };
      await expect(errorOf(client.complete(request({ use })))).resolves.toMatchObject({ code: 'model-missing' });
      expect(snapshot.slotHealth.fast).toBeUndefined();
    });

    it('stops waiting when the job is cancelled', async () => {
      const { client, respond, rows } = setup();
      client.retryDelaysMs = [60_000];
      const controller = new AbortController();
      respond(() => status(503));
      const pending = errorOf(client.complete(request({ signal: controller.signal })));
      await vi.waitFor(() => expect(rows).toHaveLength(1));
      controller.abort();
      await expect(pending).resolves.toMatchObject({ code: 'cancelled' });
    });

    it('removes the key from a provider message that echoes it', async () => {
      const { client, respondInOrder } = setup();
      const warn = vi.spyOn(Logger.prototype, 'warn');
      respondInOrder(status(400, {}, { error: { message: `Bad request for key ${KEY}` } }));
      const error = await errorOf(client.complete(request()));
      expect(error?.code).toBe('bad-request');
      expect(JSON.stringify(error?.details)).not.toContain(KEY);
      expect(error?.message).not.toContain(KEY);
      expect(warn.mock.calls.flat().join('\n')).not.toContain(KEY);
      warn.mockRestore();
    });
  });

  describe('switches and slots', () => {
    it('refuses a feature that is off without sending anything', async () => {
      const { client, http, rows } = setup({ enabled: false });
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code: 'off' });
      expect(http.send).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it("runs the admin's Try it while the feature is off", async () => {
      const { client } = setup({ enabled: false });
      await expect(client.complete(request(), { ignoreFeatureSwitch: true })).resolves.toMatchObject({ finish: 'stop' });
    });

    it('refuses an empty slot', async () => {
      const { client } = setup({ slotModel: null });
      await expect(errorOf(client.complete(request()))).resolves.toMatchObject({ code: 'slot-empty' });
    });

    it('keeps a job on the connection and model it started with', async () => {
      const { client, sent, bridge, connections } = setup();
      await client.complete(request({ use: { slot: 'fast', connectionId: 1, model: 'pinned-model', prices: null, jsonMode: 'auto' } }));
      expect(bodyOf(sent[0]).model).toBe('pinned-model');

      bridge.register({
        jobSlotChoice: () => Promise.resolve({ slot: 'fast', connectionId: 7, model: 'recorded-model', prices: null, jsonMode: 'auto' }),
      });
      await client.complete(request());
      expect(connections.resolve).toHaveBeenLastCalledWith(7);
      expect(bodyOf(sent[1]).model).toBe('recorded-model');
    });

    it('returns a refusal instead of throwing', async () => {
      const { client, respondInOrder, rows } = setup();
      respondInOrder(loadFixture('openai-chat', 'refusal'));
      await expect(client.complete(request())).resolves.toMatchObject({ finish: 'refused', text: '' });
      expect(rows[0].outcome).toBe('refused');
    });
  });

  describe('budget', () => {
    it('checks each attempt at its worst-case cost: the input at three bytes a token plus the full output allowance', async () => {
      const { client, budget } = setup();
      const user = 'x'.repeat(3000);
      await client.complete(request({ user, system: undefined, schema: undefined, maxOutputTokens: 1000 }));
      // 1,000 input tokens at $1/M and 1,000 output tokens at $4/M.
      expect(budget.checkRequest).toHaveBeenCalledWith({ feature: 'story-guides', jobId: 'job-1', worstCaseMicros: 5000 });
    });

    it('sends nothing when the request does not fit', async () => {
      const harness = setup();
      const store: AiBudgetStore = {
        locked: (work) => work(store),
        spentMicros: () => Promise.resolve(999_000),
        jobSpentMicros: () => Promise.resolve(new Map()),
        activeReservations: () => Promise.resolve([]),
        findReservation: () => Promise.resolve(null),
        buildsInMonth: () => Promise.resolve(0),
        upsertReservation: () => Promise.resolve(),
        release: () => Promise.resolve(),
      };
      harness.snapshot.budget.monthlyBudget = 1;
      const budget = new AiBudgetService(store, harness.settings as unknown as AiSettingsService, harness.bridge, harness.events);
      (harness.client as unknown as { budget: AiBudgetService }).budget = budget;

      await expect(errorOf(harness.client.complete(request()))).resolves.toMatchObject({ code: 'budget' });
      expect(harness.http.send).not.toHaveBeenCalled();
      expect(harness.rows).toHaveLength(0);
    });

    it('passes no worst case when the slot has no prices, and records an unknown cost', async () => {
      const { client, budget, rows } = setup({ prices: false });
      const result = await client.complete(request());
      expect(budget.checkRequest).toHaveBeenCalledWith(expect.objectContaining({ worstCaseMicros: null }));
      expect(result.usage.cost).toBeUndefined();
      expect(rows[0].costMicros).toBeNull();
    });

    it("prefers the provider's own cost", async () => {
      const { client, respondInOrder, rows } = setup();
      respondInOrder(loadFixture('openai-chat', 'openrouter-cost'));
      const result = await client.complete(request({ schema: undefined }));
      expect(result.usage.cost).toBe(0.00008);
      expect(rows[0].costMicros).toBe(80);
    });
  });

  describe('limiter', () => {
    it('never has more than max_parallel requests in flight under a burst', async () => {
      const { client, respond, maxInFlight, rows } = setup({ conn: connection({ maxParallel: 3 }) });
      respond(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return reply(VALID_JSON);
      });
      await Promise.all(Array.from({ length: 20 }, (_, index) => client.complete(request({ jobId: `job-${index}` }))));
      expect(maxInFlight()).toBe(3);
      expect(rows).toHaveLength(20);
    });

    it('a 429 holds the whole connection, not only the request that got it', async () => {
      vi.useFakeTimers();
      try {
        const { client, respond, http, rows } = setup();
        respond((_request, call) => (call === 1 ? status(429, { 'retry-after': '30' }) : reply(VALID_JSON)));

        const first = client.complete(request({ jobId: 'job-a' }));
        await vi.waitFor(() => expect(http.send).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(0);
        // Another feature's request on the same connection, after the 429.
        const second = client.complete(request({ slot: 'careful', jobId: 'job-b' }));

        await vi.advanceTimersByTimeAsync(29_000);
        expect(http.send).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1_001);
        await Promise.all([first, second]);
        expect(http.send).toHaveBeenCalledTimes(3);
        expect(rows.map((row) => [row.jobId, row.attempt, row.outcome])).toEqual([
          ['job-a', 1, 'rate-limited'],
          ['job-a', 2, 'ok'],
          ['job-b', 1, 'ok'],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('writes one ai_usage row per attempt, success or not', async () => {
      const { client, respond, http, rows } = setup();
      respond(
        (_request, call) =>
          [status(503), loadFixture('openai-chat', 'rejected-parameter'), reply('{', 'length'), reply('nope'), reply(VALID_JSON)][call - 1],
      );
      await client.complete(request());
      expect(http.send).toHaveBeenCalledTimes(5);
      expect(rows.map((row) => [row.attempt, row.outcome])).toEqual([
        [1, 'error:provider-down'],
        [2, 'error:bad-request'],
        [3, 'length'],
        [4, 'invalid-json'],
        [5, 'ok'],
      ]);
    });
  });
});
