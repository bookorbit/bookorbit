import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AiConnectionRow, NewAiConnectionRow } from '../../db/schema';
import { AiError } from './ai-client.types';
import { AiConnectionService } from './ai-connection.service';
import type { AiConnectionRepository } from './ai-connection.repository';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import type { AiLedgerRepository } from './ai-ledger.repository';
import { scrubSecrets } from './ai-scrub';
import { AiSecretsService } from './ai-secrets.service';

const ENV_KEY = 'a'.repeat(64);
const OTHER_ENV_KEY = 'b'.repeat(64);
const PROVIDER_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef3f9a';
const HEADER_VALUE = 'header-secret-value-77';

function secretsWith(key: string | undefined): AiSecretsService {
  return new AiSecretsService(new ConfigService({ ai: { encryptionKey: key ?? '' } }));
}

class MemoryRepo {
  rows = new Map<number, AiConnectionRow>();
  private nextId = 1;

  list() {
    return Promise.resolve([...this.rows.values()]);
  }
  findById(id: number) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  insert(values: NewAiConnectionRow) {
    if ([...this.rows.values()].some((row) => row.name.toLowerCase() === values.name.toLowerCase())) {
      return Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' }));
    }
    const now = new Date('2026-11-09T10:00:00Z');
    const row: AiConnectionRow = {
      id: this.nextId++,
      name: values.name,
      apiType: values.apiType,
      baseUrl: values.baseUrl,
      keyEncrypted: values.keyEncrypted ?? null,
      keyHint: values.keyHint ?? null,
      headers: values.headers ?? [],
      headersEncrypted: values.headersEncrypted ?? null,
      networkProfile: values.networkProfile ?? null,
      timeoutMs: values.timeoutMs ?? 120_000,
      maxParallel: values.maxParallel ?? 8,
      requestsPerMinute: values.requestsPerMinute ?? null,
      lastTest: values.lastTest ?? null,
      failingSince: null,
      failingCode: null,
      failingReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }
  update(id: number, values: Partial<NewAiConnectionRow>) {
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(null);
    const next = { ...row, ...values } as AiConnectionRow;
    this.rows.set(id, next);
    return Promise.resolve(next);
  }
  delete(id: number) {
    return Promise.resolve(this.rows.delete(id));
  }
  setFailing(id: number, code: AiConnectionRow['failingCode'], reason: string, since: Date) {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, failingSince: row.failingSince ?? since, failingCode: code, failingReason: reason });
    return Promise.resolve();
  }
  clearFailing(id: number) {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, failingSince: null, failingCode: null, failingReason: null });
    return Promise.resolve();
  }
}

const ledger = { connectionMonthTotals: vi.fn().mockResolvedValue(new Map()) } as unknown as AiLedgerRepository;

function build(envKey: string | undefined, repo = new MemoryRepo()) {
  const events = new AiEventsService();
  const service = new AiConnectionService(repo as unknown as AiConnectionRepository, ledger, secretsWith(envKey), events);
  return { service, repo, events };
}

const keyed = {
  name: 'OpenRouter',
  apiType: 'openai-chat' as const,
  baseUrl: 'https://openrouter.ai/api/v1',
  key: PROVIDER_KEY,
  headers: [{ name: 'X-Title', value: HEADER_VALUE }],
};

describe('AiSecretsService', () => {
  it('round-trips a value and hints only its last four characters', () => {
    const secrets = secretsWith(ENV_KEY);
    const sealed = secrets.encrypt(PROVIDER_KEY);
    expect(sealed).not.toContain(PROVIDER_KEY);
    expect(secrets.decrypt(sealed)).toBe(PROVIDER_KEY);
    expect(AiSecretsService.hint(PROVIDER_KEY)).toBe('3f9a');
    expect(AiSecretsService.hint('abc')).toBe('');
  });

  it('refuses to store a secret without the env var, with the command in the message', () => {
    const secrets = secretsWith(undefined);
    expect(secrets.isConfigured()).toBe(false);
    expect(() => secrets.encrypt(PROVIDER_KEY)).toThrow('openssl rand -hex 32');
    try {
      secrets.encrypt(PROVIDER_KEY);
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({ errorCode: 'AI_ENCRYPTION_KEY_MISSING' });
    }
  });

  it('reads nothing back once the env var changes', () => {
    const sealed = secretsWith(ENV_KEY).encrypt(PROVIDER_KEY);
    expect(secretsWith(OTHER_ENV_KEY).decrypt(sealed)).toBeNull();
    expect(secretsWith(undefined).decrypt(sealed)).toBeNull();
    expect(secretsWith(OTHER_ENV_KEY).openHeaders(secretsWith(ENV_KEY).sealHeaders([{ name: 'a', value: 'b' }]))).toBeNull();
  });
});

describe('scrubSecrets', () => {
  it('removes stored secrets, in plain and URL-encoded form', () => {
    const text = `Invalid key ${PROVIDER_KEY} for header ${HEADER_VALUE}; url ?key=${encodeURIComponent('p@ss/word+1')}`;
    const scrubbed = scrubSecrets(text, [PROVIDER_KEY, HEADER_VALUE, 'p@ss/word+1']);
    expect(scrubbed).not.toContain(PROVIDER_KEY);
    expect(scrubbed).not.toContain(HEADER_VALUE);
    expect(scrubbed).not.toContain(encodeURIComponent('p@ss/word+1'));
  });

  it.each([
    ['Authorization: Bearer abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
    ['{"x-api-key": "zzzzzzzzzzzzzzzz"}', 'zzzzzzzzzzzzzzzz'],
    ['api-key=azure0123456789', 'azure0123456789'],
    ['Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrSt', 'sk-proj-AbCdEfGhIjKlMnOpQrSt'],
    ['key sk-ant-api03-abcdefghijklmnopqrstu', 'sk-ant-api03-abcdefghijklmnopqrstu'],
    ['API key AIzaSyA1234567890abcdefghijklmn not valid', 'AIzaSyA1234567890abcdefghijklmn'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghij', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghij'],
  ])('removes anything shaped like a credential: %s', (text, secret) => {
    expect(scrubSecrets(text)).not.toContain(secret);
  });

  it('leaves ordinary provider messages readable and short', () => {
    expect(scrubSecrets('The model `gpt-6-luna` does not exist')).toBe('The model `gpt-6-luna` does not exist');
    expect(scrubSecrets('x'.repeat(2000)).length).toBeLessThan(510);
  });
});

describe('AiConnectionService', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(logged.join('\n')).not.toContain(PROVIDER_KEY);
    expect(logged.join('\n')).not.toContain(HEADER_VALUE);
  });

  it('saves a keyless connection without the env var', async () => {
    const { service } = build(undefined);
    const row = await service.create({ name: 'Ollama', apiType: 'openai-chat', baseUrl: 'http://localhost:11434' });
    const response = service.toResponse(row);
    expect(response).toMatchObject({ hasKey: false, keyHint: null, baseUrl: 'http://localhost:11434/v1', status: 'untested', usable: true });
  });

  it('refuses a key or header value without the env var', async () => {
    const { service } = build(undefined);
    await expect(service.create({ ...keyed, headers: [] })).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...keyed, key: null })).rejects.toThrow('AI_ENCRYPTION_KEY');
  });

  it('never returns a stored key or header value', async () => {
    const { service } = build(ENV_KEY);
    const row = await service.create(keyed);
    expect(row.keyEncrypted).not.toContain(PROVIDER_KEY);
    expect(row.headersEncrypted).not.toContain(HEADER_VALUE);

    const bodies = [
      service.toResponse(row),
      await service.get(row.id),
      await service.list(),
      (await service.update(row.id, { name: 'Renamed' })).row,
    ];
    for (const body of bodies.slice(0, 3)) {
      const json = JSON.stringify(body);
      expect(json).not.toContain(PROVIDER_KEY);
      expect(json).not.toContain(HEADER_VALUE);
      expect(json).not.toContain('keyEncrypted');
      expect(json).not.toContain('headersEncrypted');
    }
    expect(service.toResponse(row)).toMatchObject({
      hasKey: true,
      keyHint: '3f9a',
      headers: [{ name: 'X-Title', hasValue: true, valueHint: 'e-77' }],
    });
  });

  it('keeps the key when an edit leaves it out, and removes it on null', async () => {
    const { service, repo } = build(ENV_KEY);
    const row = await service.create(keyed);
    const kept = await service.update(row.id, { timeoutMs: 30_000 });
    expect(kept.changes).toEqual({ fields: ['timeoutMs'], key: null });
    expect(repo.rows.get(row.id)?.keyEncrypted).toBe(row.keyEncrypted);

    const headersKept = await service.update(row.id, { headers: [{ name: 'X-Title' }, { name: 'HTTP-Referer', value: 'https://bookorbit.app' }] });
    const resolved = await service.resolve(row.id);
    expect(resolved.headers).toEqual([
      { name: 'X-Title', value: HEADER_VALUE },
      { name: 'HTTP-Referer', value: 'https://bookorbit.app' },
    ]);
    expect(headersKept.changes.fields).toEqual(['headers']);

    const removed = await service.update(row.id, { key: null });
    expect(removed.changes).toEqual({ fields: ['key'], key: 'removed' });
    expect(service.toResponse(removed.row)).toMatchObject({ hasKey: false, keyHint: null });
  });

  it('refuses headers that would override what the API type sends', async () => {
    const { service } = build(ENV_KEY);
    for (const name of ['Authorization', 'x-api-key', 'Content-Type', 'anthropic-version']) {
      await expect(service.create({ ...keyed, headers: [{ name, value: 'x' }] })).rejects.toThrow('cannot be overridden');
    }
    await expect(service.create({ ...keyed, headers: [{ name: 'api-key', value: 'azure-key-123456' }] })).resolves.toBeTruthy();
  });

  it('refuses a second connection with the same name', async () => {
    const { service } = build(ENV_KEY);
    await service.create(keyed);
    await expect(service.create({ ...keyed, name: 'openrouter' })).rejects.toThrow(ConflictException);
  });

  it('marks a connection failing when the env key changed after its key was saved', async () => {
    const repo = new MemoryRepo();
    const saved = await build(ENV_KEY, repo).service.create(keyed);

    const { service, events } = build(OTHER_ENV_KEY, repo);
    const failing = vi.fn();
    events.on(AI_EVENTS.CONNECTION_FAILING, failing);

    expect(service.toResponse(repo.rows.get(saved.id)!)).toMatchObject({
      status: 'failing',
      failingCode: 'key-unreadable',
      failingReason: "Saved key can't be read; enter it again",
    });

    await service.onApplicationBootstrap();
    expect(repo.rows.get(saved.id)).toMatchObject({ failingCode: 'key-unreadable' });
    expect(failing).toHaveBeenCalledWith({ connectionId: saved.id, code: 'key-unreadable' });

    const error = await service.resolve(saved.id).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'provider-auth', details: { failure: 'key-unreadable' } });

    // Entering the key and header values again clears it.
    const { row } = await service.update(saved.id, { key: PROVIDER_KEY, headers: [{ name: 'X-Title', value: HEADER_VALUE }] });
    expect(service.toResponse(row)).toMatchObject({ status: 'untested', failingCode: null });
  });

  it('lists a connection of an API type this build does not know as unusable', async () => {
    const { service, repo } = build(ENV_KEY);
    const row = await service.create({ name: 'Future', apiType: 'openai-chat', baseUrl: 'https://example.com/v1' });
    repo.rows.set(row.id, { ...row, apiType: 'gemini-native' });
    expect(service.toResponse(repo.rows.get(row.id)!)).toMatchObject({
      apiType: 'gemini-native',
      usable: false,
      status: 'failing',
      failingCode: 'unsupported-api-type',
    });
    await expect(service.resolve(row.id)).rejects.toMatchObject({ code: 'provider-auth' });
  });

  it('fills an unsaved test from the saved connection when the key was not retyped', async () => {
    const { service } = build(ENV_KEY);
    const row = await service.create(keyed);
    const draft = await service.resolveDraft({ ...keyed, key: undefined, headers: [{ name: 'X-Title' }], connectionId: row.id });
    expect(draft.key).toBe(PROVIDER_KEY);
    expect(draft.headers).toEqual([{ name: 'X-Title', value: HEADER_VALUE }]);
    expect(AiConnectionService.secretsOf(draft)).toEqual([PROVIDER_KEY, HEADER_VALUE]);
  });
});
