import { NotFoundException } from '@nestjs/common';
import { AI_API_TYPES, type AiApiType, type AiConnectionTest } from '@bookorbit/types';

import type { AiConnectionRow, NewAiUsageRow } from '../../db/schema';
import type { AiBudgetService } from './ai-budget.service';
import { AiClient } from './ai-client.service';
import { AiError } from './ai-client.types';
import { AiConnectionTestService } from './ai-connection-test.service';
import type { AiConnectionRepository } from './ai-connection.repository';
import type { AiConnectionService, ResolvedAiConnection } from './ai-connection.service';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import type { AiLedgerRepository } from './ai-ledger.repository';
import { AiLimiterService } from './ai-limiter';
import { AiHttpService } from './ai-network';
import { defaultFeatureSettings, emptySlot, type AiSettingsService, type AiSettingsSnapshot } from './ai-settings.service';
import { AiTryService } from './ai-try.service';
import { AI_STUB_TRY_NAMES, AI_STUB_VISION_BOOKS, startAiStubProvider, type AiStubProvider } from './testing/ai-stub-provider';
import { AI_VISION_SAMPLE } from './ai-vision-sample';

const KEY = 'sk-stub-test-key-0001';

let stub: AiStubProvider;

beforeAll(async () => {
  stub = await startAiStubProvider();
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.requests.length = 0;
  Object.assign(stub.options, {
    key: KEY,
    models: ['text-embedding-3-small', 'stub-model-a', 'stub-model-b'],
    rejectJsonParameter: false,
    omitUsage: false,
    webPage: false,
    rejectImages: false,
  });
});

function resolved(apiType: AiApiType, overrides: Partial<ResolvedAiConnection> = {}): ResolvedAiConnection {
  return {
    id: 1,
    name: 'Stub',
    apiType,
    baseUrl: stub.baseUrl(apiType),
    key: KEY,
    headers: [],
    networkProfile: null,
    timeoutMs: 10_000,
    maxParallel: 4,
    requestsPerMinute: null,
    jsonSupport: null,
    ...overrides,
  };
}

function row(overrides: Partial<AiConnectionRow> = {}): AiConnectionRow {
  const now = new Date();
  return {
    id: 1,
    name: 'Stub',
    apiType: 'openai-chat',
    baseUrl: stub.baseUrl('openai-chat'),
    keyEncrypted: 'encrypted',
    keyHint: '0001',
    headers: [],
    headersEncrypted: null,
    networkProfile: null,
    timeoutMs: 10_000,
    maxParallel: 4,
    requestsPerMinute: null,
    lastTest: null,
    failingSince: null,
    failingCode: null,
    failingReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup(apiType: AiApiType = 'openai-chat', connectionOverrides: Partial<ResolvedAiConnection> = {}) {
  const connection = resolved(apiType, connectionOverrides);
  const snapshot: AiSettingsSnapshot = {
    slots: {
      fast: { ...emptySlot(), connectionId: 1, model: 'stub-model-b', prices: { input: 1, output: 4 } },
      careful: emptySlot(),
      vision: { ...emptySlot(), connectionId: 1, model: 'stub-model-a' },
    },
    slotHealth: {},
    features: {
      'story-guides': defaultFeatureSettings('story-guides'),
      'vision-scan': defaultFeatureSettings('vision-scan'),
      'reading-help': defaultFeatureSettings('reading-help'),
    },
    budget: { monthlyBudget: null, buildsPerMonth: null },
    privacy: {},
  };
  const settings = {
    snapshot: () => Promise.resolve(structuredClone(snapshot)),
    slots: () => Promise.resolve(structuredClone(snapshot.slots)),
    slotHealth: () => Promise.resolve(structuredClone(snapshot.slotHealth)),
    setSlotHealth: vi.fn((slot: 'fast' | 'careful', health: null) => {
      if (health === null) delete snapshot.slotHealth[slot];
      return Promise.resolve();
    }),
  };
  const rows = [row({ apiType, baseUrl: connection.baseUrl })];
  const repo = {
    list: () => Promise.resolve(rows),
    findById: (id: number) => Promise.resolve(rows.find((entry) => entry.id === id) ?? null),
    setLastTest: vi.fn((id: number, test: AiConnectionTest) => {
      const target = rows.find((entry) => entry.id === id);
      if (target) target.lastTest = test;
      return Promise.resolve();
    }),
  };
  const connections = {
    getRow: (id: number) => {
      const found = rows.find((entry) => entry.id === id);
      return found ? Promise.resolve(found) : Promise.reject(new NotFoundException('AI connection not found'));
    },
    resolveRow: vi.fn(() => Promise.resolve(connection)),
    resolve: () => Promise.resolve(connection),
    markHealthy: vi.fn(() => Promise.resolve()),
    markFailing: vi.fn(() => Promise.resolve()),
  };
  const ledgerRows: NewAiUsageRow[] = [];
  const ledger = { insert: (entry: NewAiUsageRow) => Promise.resolve(void ledgerRows.push(entry)) };
  const events = new AiEventsService();
  const http = new AiHttpService();
  const tester = new AiConnectionTestService(
    connections as unknown as AiConnectionService,
    repo as unknown as AiConnectionRepository,
    settings as unknown as AiSettingsService,
    ledger as unknown as AiLedgerRepository,
    http,
    events,
  );
  const client = new AiClient(
    connections as unknown as AiConnectionService,
    settings as unknown as AiSettingsService,
    { checkRequest: () => Promise.resolve() } as unknown as AiBudgetService,
    ledger as unknown as AiLedgerRepository,
    new AiLimiterService(),
    http,
    new AiJobsBridge(),
    events,
  );
  const tryService = new AiTryService(client, settings as unknown as AiSettingsService, repo as unknown as AiConnectionRepository);
  return { connection, snapshot, settings, rows, repo, connections, ledgerRows, events, tester, tryService };
}

const stepsOf = (test: AiConnectionTest) => Object.fromEntries(test.steps.map((step) => [step.id, step]));

describe.each(AI_API_TYPES)('against a local %s provider', (apiType) => {
  it('passes every row with the JSON schema enforced', async () => {
    const { tester, connection, ledgerRows } = setup(apiType);
    const result = await tester.test(connection);
    expect(result).toMatchObject({
      ok: true,
      model: 'stub-model-a',
      jsonSupport: 'schema',
      modelCount: 3,
      host: new URL(stub.baseUrl(apiType)).host,
    });
    expect(result.steps.map((step) => [step.id, step.ok])).toEqual([
      ['reach', true],
      ['key', true],
      ['models', true],
      ['json', true],
      ['usage', true],
      ['image', true],
    ]);
    expect(stepsOf(result).reach.durationMs).toEqual(expect.any(Number));
    expect(result.models?.models.map((model) => model.id)).toEqual(['text-embedding-3-small', 'stub-model-a', 'stub-model-b']);
    expect(ledgerRows).toEqual([
      expect.objectContaining({ feature: 'connection-test', slot: 'test', model: 'stub-model-a', outcome: 'ok', inputTokens: 120 }),
      expect.objectContaining({ feature: 'connection-test', slot: 'test', model: 'stub-model-a', outcome: 'ok', attempt: 2 }),
    ]);
    expect(JSON.stringify(stub.requests.at(-1)?.body)).toContain(AI_VISION_SAMPLE.data);
  });

  it('flags a model that cannot read pictures without failing the test', async () => {
    stub.options.rejectImages = true;
    const { tester, connection } = setup(apiType);
    const result = await tester.test(connection);
    expect(result.ok).toBe(true);
    expect(stepsOf(result).image).toMatchObject({ ok: false, code: 'no-image-input' });
  });

  it('runs Try it on the Vision slot with the sample picture', async () => {
    const { tryService } = setup(apiType);
    const result = await tryService.run('vision');
    expect(result).toMatchObject({
      slot: 'vision',
      model: 'stub-model-a',
      names: [],
      books: AI_STUB_VISION_BOOKS.map(({ title, author }) => ({ title, author })),
      costMicros: null,
    });
    expect(JSON.stringify(stub.requests.at(-1)?.body)).toContain(AI_VISION_SAMPLE.data);
  });

  it('falls back to instructions when the model refuses every JSON parameter', async () => {
    stub.options.rejectJsonParameter = true;
    const { tester, connection } = setup(apiType);
    const result = await tester.test(connection);
    expect(result).toMatchObject({ ok: true, jsonSupport: 'instructions' });
    expect(stepsOf(result).json).toMatchObject({ ok: true, jsonSupport: 'instructions' });
  });

  it('fails the key row for a wrong key and stops there', async () => {
    const { tester, connection } = setup(apiType, { key: 'sk-wrong-key-000000' });
    const result = await tester.test(connection);
    expect(result.ok).toBe(false);
    expect(stepsOf(result).reach.ok).toBe(true);
    expect(stepsOf(result).key).toMatchObject({ ok: false, code: 'key-rejected' });
    expect(stepsOf(result).json.ok).toBeNull();
    expect(JSON.stringify(result)).not.toContain('sk-wrong-key-000000');
  });

  it('tests the model the slots use, or the one asked for', async () => {
    const { tester, connection } = setup(apiType);
    await expect(tester.test(connection, { slotModel: 'stub-model-b' })).resolves.toMatchObject({ ok: true, model: 'stub-model-b' });
    const missing = await tester.test(connection, { model: 'retired-model' });
    expect(stepsOf(missing).json).toMatchObject({ ok: false, code: 'model-missing' });
  });

  it('runs Try it on the sample passage', async () => {
    const { tryService } = setup(apiType);
    const result = await tryService.run('fast');
    expect(result).toMatchObject({
      slot: 'fast',
      model: 'stub-model-b',
      names: AI_STUB_TRY_NAMES,
      usage: { input: 120, output: 30 },
      costMicros: 240,
      jsonSupport: 'schema',
    });
    const body = JSON.stringify(stub.requests.at(-1)?.body);
    expect(body).toContain('It is a truth universally acknowledged');
  });
});

describe('AiConnectionTestService', () => {
  it('says a provider without a model list needs the model typed, and tests the typed one', async () => {
    stub.options.models = null;
    const { tester, connection } = setup();
    const untyped = await tester.test(connection);
    expect(stepsOf(untyped).models).toMatchObject({ ok: true, code: 'no-model-list', modelCount: 0 });
    expect(stepsOf(untyped).json).toMatchObject({ ok: false, code: 'no-model' });
    expect(untyped.ok).toBe(false);

    const typed = await tester.test(connection, { model: 'llama3.3' });
    expect(typed).toMatchObject({ ok: true, model: 'llama3.3', modelCount: null });
  });

  it('passes a keyless local runner on the strength of its reply', async () => {
    stub.options.key = null;
    const { tester, connection } = setup('openai-chat', { key: null });
    const result = await tester.test(connection);
    expect(result.ok).toBe(true);
    expect(stepsOf(result).key.ok).toBe(true);
  });

  it('flags missing usage without failing the test', async () => {
    stub.options.omitUsage = true;
    const { tester, connection } = setup();
    const result = await tester.test(connection);
    expect(result.ok).toBe(true);
    expect(stepsOf(result).usage).toMatchObject({ ok: false, code: 'no-usage' });
  });

  it('says a URL that answers with a web page is not an API', async () => {
    stub.options.webPage = true;
    const { tester, connection } = setup();
    const result = await tester.test(connection);
    expect(stepsOf(result).reach).toMatchObject({ ok: false, code: 'web-page', message: 'This URL answered with a web page, not an API' });
  });

  it('says when nothing listens at the address', async () => {
    const { tester } = setup();
    const result = await tester.test(resolved('openai-chat', { baseUrl: 'http://127.0.0.1:9/v1' }));
    expect(stepsOf(result).reach).toMatchObject({ ok: false, code: 'unreachable' });
    expect(result.steps.slice(1).every((step) => step.ok === null)).toBe(true);
  });

  it('stores a saved test without the model list, and clears failing state and slot health on a pass', async () => {
    const { tester, rows, repo, connections, snapshot, events } = setup();
    rows[0].failingSince = new Date();
    rows[0].failingCode = 'unreachable';
    snapshot.slotHealth.fast = {
      failingSince: new Date().toISOString(),
      code: 'model-missing',
      reason: 'Model no longer available',
      model: 'stub-model-b',
    };
    const healthy = vi.fn();
    events.on(AI_EVENTS.SLOT_HEALTHY, healthy);

    const result = await tester.testSaved(1);
    expect(result).toMatchObject({ ok: true, model: 'stub-model-b' });
    expect(repo.setLastTest).toHaveBeenCalledWith(1, expect.not.objectContaining({ models: expect.anything() }));
    expect(rows[0].lastTest).toMatchObject({ ok: true, modelCount: 3 });
    expect(connections.markHealthy).toHaveBeenCalledWith(1);
    expect(snapshot.slotHealth.fast).toBeUndefined();
    expect(healthy).toHaveBeenCalledWith({ slot: 'fast' });
  });

  it('does not mark a connection failing for a failed manual test', async () => {
    const { tester, connections } = setup('openai-chat', { key: 'sk-wrong-key-000000' });
    await expect(tester.testSaved(1)).resolves.toMatchObject({ ok: false });
    expect(connections.markFailing).not.toHaveBeenCalled();
    expect(connections.markHealthy).not.toHaveBeenCalled();
  });

  it('reports a key that no longer decrypts on the key row', async () => {
    const { tester, connections } = setup();
    connections.resolveRow.mockRejectedValueOnce(
      new AiError('provider-auth', "Saved key can't be read; enter it again", { failure: 'key-unreadable' }),
    );
    const result = await tester.testSaved(1);
    expect(stepsOf(result).key).toMatchObject({ ok: false, code: 'key-unreadable' });
  });

  it('retests connections failing with something that may pass, for a day', async () => {
    const { tester, rows } = setup();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    rows.push(
      row({ id: 2, failingSince: hourAgo, failingCode: 'key-rejected' }),
      row({ id: 3, failingSince: new Date(Date.now() - 25 * 60 * 60 * 1000), failingCode: 'unreachable' }),
      row({ id: 4 }),
    );
    rows[0].failingSince = hourAgo;
    rows[0].failingCode = 'timeout';
    const spy = vi.spyOn(tester, 'testSaved');
    await tester.retestFailing();
    expect(spy.mock.calls.map((call) => call[0])).toEqual([1]);
  });

  it('lists models, and reports a provider failure without the key', async () => {
    const { tester } = setup();
    await expect(tester.listModels(1)).resolves.toMatchObject({
      listed: true,
      models: [{ id: 'text-embedding-3-small' }, { id: 'stub-model-a' }, { id: 'stub-model-b' }],
    });

    const broken = setup('openai-chat', { key: 'sk-wrong-key-000000' });
    const error = (await broken.tester.listModels(1).catch((err: unknown) => err)) as { getResponse(): unknown };
    expect(error.getResponse()).toMatchObject({ errorCode: 'AI_PROVIDER_FAILED' });
    expect(JSON.stringify(error.getResponse())).not.toContain('sk-wrong-key-000000');
  });

  it('answers 404 when listing the models of a connection that does not exist', async () => {
    const { tester } = setup();
    await expect(tester.listModels(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AiTryService', () => {
  it('needs a slot with a connection and model', async () => {
    const { tryService, snapshot } = setup();
    snapshot.slots.fast = emptySlot();
    const error = (await tryService.run('fast').catch((err: unknown) => err)) as { getResponse(): unknown };
    expect(error.getResponse()).toMatchObject({ errorCode: 'AI_SLOT_EMPTY' });
  });

  it('reports a failure with the client error code', async () => {
    const { tryService } = setup('openai-chat', { key: 'sk-wrong-key-000000' });
    const error = (await tryService.run('fast').catch((err: unknown) => err)) as { getResponse(): unknown };
    expect(error.getResponse()).toMatchObject({ errorCode: 'AI_TRY_FAILED', errorMeta: { code: 'provider-auth', failure: 'key-rejected' } });
  });
});
