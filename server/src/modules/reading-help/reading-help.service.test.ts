import { HttpException, Logger, NotFoundException } from '@nestjs/common';

import type { ReadingHelpEvent, ReadingHelpRequest } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AiBudgetService } from '../ai/ai-budget.service';
import type { AiClient, AiStreamEvent } from '../ai/ai-client.service';
import { AiError, type AiRequest, type AiResult, type AiSlotChoice } from '../ai/ai-client.types';
import type { AiLedgerRepository } from '../ai/ai-ledger.repository';
import { defaultFeatureSettings, emptySlot, type AiSettingsService, type AiSettingsSnapshot } from '../ai/ai-settings.service';
import type { BookService } from '../book/book.service';
import type { ReadingHelpCacheRepository } from './reading-help-cache.repository';
import { readingHelpCacheKey, ReadingHelpService, type ReadingHelpAnswer } from './reading-help.service';

const user = { id: 7 } as RequestUser;

const term = (overrides: Partial<ReadingHelpRequest> = {}): ReadingHelpRequest => ({
  kind: 'term',
  fileId: 41,
  language: 'en',
  term: 'Darcy',
  passages: ['Mr Darcy walked in.', 'He refused to dance.'],
  ...overrides,
});

const choiceFor = (slot: 'fast' | 'careful', prices = true): AiSlotChoice => ({
  slot,
  connectionId: 3,
  model: slot === 'fast' ? 'fast-model' : 'careful-model',
  prices: prices ? { input: 1, output: 4 } : null,
  jsonMode: 'auto',
});

function result(text: string, finish: AiResult['finish'] = 'stop'): AiResult {
  return { text, finish, usage: { input: 900, output: 40 }, model: 'fast-model' };
}

function setup(options: { enabled?: boolean; fast?: boolean; careful?: boolean; prices?: boolean; cached?: string | null } = {}) {
  const filled = { ...emptySlot(), connectionId: 3, model: 'fast-model' };
  const snapshot: AiSettingsSnapshot = {
    slots: {
      fast: options.fast === false ? emptySlot() : filled,
      careful: options.careful === false ? emptySlot() : { ...filled, model: 'careful-model' },
      vision: emptySlot(),
    },
    slotHealth: {},
    features: {
      'story-guides': defaultFeatureSettings('story-guides'),
      'vision-scan': defaultFeatureSettings('vision-scan'),
      'reading-help': { ...defaultFeatureSettings('reading-help'), enabled: options.enabled ?? true },
    },
    budget: { monthlyBudget: null, buildsPerMonth: null },
    privacy: {},
  };
  let script: (request: AiRequest) => AsyncGenerator<AiStreamEvent, void, undefined> = async function* () {
    await Promise.resolve();
    yield { delta: 'Darcy is proud.' };
    yield { done: result('Darcy is proud.') };
  };
  const stream = vi.fn((request: AiRequest, streamOptions?: { stopWhen?: (text: string) => boolean }) => {
    void streamOptions;
    return script(request);
  });
  const ai = { stream, resolveSlot: vi.fn((slot: 'fast' | 'careful') => Promise.resolve(choiceFor(slot, options.prices ?? true))) };
  const settings = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(snapshot))),
    features: vi.fn(() => Promise.resolve(structuredClone(snapshot.features))),
    slots: vi.fn(() => Promise.resolve(structuredClone(snapshot.slots))),
  };
  const budget = { checkRequest: vi.fn(() => Promise.resolve()) };
  const ledger = { readerSpend: vi.fn(() => Promise.resolve({ requests: 0, costMicros: 0 })) };
  const cache = {
    take: vi.fn(() => Promise.resolve(options.cached ?? null)),
    put: vi.fn(() => Promise.resolve()),
    sweep: vi.fn(() => Promise.resolve({ expired: 0, evicted: 0 })),
  };
  const books = { verifyFileAccess: vi.fn(() => Promise.resolve()) };
  const service = new ReadingHelpService(
    ai as unknown as AiClient,
    settings as unknown as AiSettingsService,
    budget as unknown as AiBudgetService,
    ledger as unknown as AiLedgerRepository,
    cache as unknown as ReadingHelpCacheRepository,
    books as unknown as BookService,
  );
  return {
    service,
    snapshot,
    stream,
    ai,
    budget,
    ledger,
    cache,
    books,
    script: (next: typeof script) => (script = next),
  };
}

async function events(promise: Promise<ReadingHelpAnswer>): Promise<ReadingHelpEvent[]> {
  const out: ReadingHelpEvent[] = [];
  for await (const event of await promise) out.push(event);
  return out;
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; errorCode?: string }> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { status: error.getStatus(), errorCode: (error.getResponse() as { errorCode?: string }).errorCode };
  }
  throw new Error('expected the request to be refused');
}

const signal = () => new AbortController().signal;

describe('ReadingHelpService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('appInfo', () => {
    it('is on when the feature is on and Fast has a model, and says whether Careful does', async () => {
      await expect(setup().service.appInfo()).resolves.toEqual({ enabled: true, careful: true, passageTokens: 8_000 });
      await expect(setup({ careful: false }).service.appInfo()).resolves.toMatchObject({ enabled: true, careful: false });
      await expect(setup({ enabled: false }).service.appInfo()).resolves.toMatchObject({ enabled: false });
      await expect(setup({ fast: false }).service.appInfo()).resolves.toMatchObject({ enabled: false });
    });
  });

  describe('before the answer starts', () => {
    it('refuses when reading help is off or Fast has no model', async () => {
      await expect(refusal(setup({ enabled: false }).service.answer(user, term(), signal()))).resolves.toEqual({
        status: 403,
        errorCode: 'READING_HELP_OFF',
      });
      await expect(refusal(setup({ fast: false }).service.answer(user, term(), signal()))).resolves.toEqual({
        status: 403,
        errorCode: 'READING_HELP_OFF',
      });
    });

    it('refuses a careful answer when no careful model is set', async () => {
      const { service, stream } = setup({ careful: false });
      await expect(refusal(service.answer(user, term({ careful: true }), signal()))).resolves.toEqual({
        status: 409,
        errorCode: 'READING_HELP_CAREFUL_OFF',
      });
      expect(stream).not.toHaveBeenCalled();
    });

    it.each([
      ['a term with no term', term({ term: '  ' })],
      ['a description with no term', term({ kind: 'description', term: undefined })],
      ['a recap note with two passages', term({ kind: 'recap-note', term: undefined })],
      ['passages longer than one answer reads', term({ passages: Array.from({ length: 6 }, () => 'x'.repeat(11_000)) })],
    ])('refuses %s', async (_label, request) => {
      const { service, stream } = setup();
      await expect(refusal(service.answer(user, request, signal()))).resolves.toMatchObject({ status: 400 });
      expect(stream).not.toHaveBeenCalled();
    });

    it('checks the reader may open the file before anything else is spent', async () => {
      const { service, books, cache, stream } = setup();
      books.verifyFileAccess.mockRejectedValue(new NotFoundException('File not found'));
      await expect(service.answer(user, term(), signal())).rejects.toBeInstanceOf(NotFoundException);
      expect(books.verifyFileAccess).toHaveBeenCalledWith(41, user);
      expect(cache.take).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    });

    it('answers from the cache without checking the reader cap or calling the model', async () => {
      const { service, stream, ledger } = setup({ cached: 'Darcy is a proud gentleman.' });
      await expect(events(service.answer(user, term(), signal()))).resolves.toEqual([
        { type: 'done', text: 'Darcy is a proud gentleman.', cached: true, careful: false },
      ]);
      expect(stream).not.toHaveBeenCalled();
      expect(ledger.readerSpend).not.toHaveBeenCalled();
    });

    it('stops a reader who used their monthly dollars, when the slot has prices', async () => {
      const { service, ledger, stream } = setup();
      ledger.readerSpend.mockResolvedValue({ requests: 12, costMicros: 1_000_000 });
      await expect(refusal(service.answer(user, term(), signal()))).resolves.toEqual({ status: 429, errorCode: 'READING_HELP_READER_CAP' });
      expect(ledger.readerSpend).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 'reading-help', 7);
      expect(stream).not.toHaveBeenCalled();
    });

    it('counts requests instead when the slot has no prices', async () => {
      const { service, ledger } = setup({ prices: false });
      ledger.readerSpend.mockResolvedValue({ requests: 299, costMicros: 0 });
      await expect(events(service.answer(user, term(), signal()))).resolves.toHaveLength(2);
      ledger.readerSpend.mockResolvedValue({ requests: 300, costMicros: 0 });
      await expect(refusal(service.answer(user, term(), signal()))).resolves.toMatchObject({ errorCode: 'READING_HELP_READER_CAP' });
    });

    it('lets a reader through when the admin cleared the cap', async () => {
      const { service, ledger, snapshot } = setup();
      snapshot.features['reading-help'].readerMonthlyBudget = null;
      ledger.readerSpend.mockResolvedValue({ requests: 5_000, costMicros: 99_000_000 });
      await expect(events(service.answer(user, term(), signal()))).resolves.toHaveLength(2);
      expect(ledger.readerSpend).not.toHaveBeenCalled();
    });

    it('refuses when the feature budget is spent', async () => {
      const { service, budget } = setup();
      budget.checkRequest.mockRejectedValue(new AiError('budget', 'spent'));
      await expect(refusal(service.answer(user, term(), signal()))).resolves.toEqual({ status: 403, errorCode: 'READING_HELP_BUDGET' });
    });
  });

  describe('the answer', () => {
    it('streams up to the sentence cap, caches it and asks the Fast model briefly for this reader', async () => {
      const t = setup();
      t.script(async function* () {
        await Promise.resolve();
        yield { delta: 'Darcy is proud. ' };
        yield { delta: 'He owns **Pemberley**. He' };
        yield { done: result('Darcy is proud. He owns **Pemberley**. He') };
      });
      const out = await events(t.service.answer(user, term(), signal()));

      expect(out).toEqual([
        { type: 'delta', text: 'Darcy is proud. ' },
        { type: 'delta', text: 'He owns **Pemberley**.' },
        { type: 'done', text: 'Darcy is proud. He owns Pemberley.', cached: false, careful: false },
      ]);
      const [request, options] = t.stream.mock.calls[0];
      expect(request).toMatchObject({ feature: 'reading-help', slot: 'fast', userId: 7, effort: 'low', maxOutputTokens: 2_000 });
      expect(request.use).toMatchObject({ slot: 'fast', model: 'fast-model' });
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(options?.stopWhen?.('One. Two. Three')).toBe(true);
      expect(options?.stopWhen?.('One. Two.')).toBe(false);
      expect(t.cache.put).toHaveBeenCalledWith(expect.objectContaining({ kind: 'term', answer: 'Darcy is proud. He owns Pemberley.' }));
    });

    it('asks the Careful model when the reader asks more carefully', async () => {
      const t = setup();
      const out = await events(t.service.answer(user, term({ careful: true }), signal()));
      expect(out.at(-1)).toMatchObject({ type: 'done', careful: true });
      expect(t.stream.mock.calls[0][0]).toMatchObject({ slot: 'careful', effort: 'medium', maxOutputTokens: 6_000 });
    });

    it('does not cache an answer cut short', async () => {
      const t = setup();
      t.script(async function* () {
        await Promise.resolve();
        yield { delta: 'Darcy is' };
        yield { done: result('Darcy is', 'length') };
      });
      const out = await events(t.service.answer(user, term(), signal()));
      expect(out.at(-1)).toEqual({ type: 'done', text: 'Darcy is', cached: false, careful: false });
      expect(t.cache.put).not.toHaveBeenCalled();
    });

    it('reports a refusal as an error event and caches nothing', async () => {
      const t = setup();
      t.script(async function* () {
        await Promise.resolve();
        yield { done: result('', 'refused') };
      });
      await expect(events(t.service.answer(user, term(), signal()))).resolves.toEqual([
        { type: 'error', errorCode: 'READING_HELP_REFUSED', message: expect.any(String) },
      ]);
      expect(t.cache.put).not.toHaveBeenCalled();
    });

    it.each([
      ['budget', 'READING_HELP_BUDGET'],
      ['too-long', 'READING_HELP_TOO_LONG'],
      ['off', 'READING_HELP_OFF'],
      ['provider-down', 'READING_HELP_PROVIDER'],
    ] as const)('turns the AI error %s into %s', async (code, errorCode) => {
      const t = setup();
      t.script(async function* () {
        await Promise.resolve();
        yield* [];
        throw new AiError(code, 'failed');
      });
      await expect(events(t.service.answer(user, term(), signal()))).resolves.toEqual([{ type: 'error', errorCode, message: expect.any(String) }]);
    });

    it('ends quietly when the app hangs up, and passes the hang-up to the model call', async () => {
      const t = setup();
      const hangUp = new AbortController();
      t.script(async function* (request) {
        await Promise.resolve();
        yield { delta: 'Darcy ' };
        hangUp.abort();
        expect(request.signal?.aborted).toBe(true);
        throw new AiError('cancelled', 'cancelled');
      });
      await expect(events(t.service.answer(user, term(), hangUp.signal))).resolves.toEqual([{ type: 'delta', text: 'Darcy ' }]);
      expect(t.cache.put).not.toHaveBeenCalled();
    });

    it('still answers when the cache cannot be written', async () => {
      const t = setup();
      t.cache.put.mockRejectedValue(new Error('disk full'));
      await expect(events(t.service.answer(user, term(), signal()))).resolves.toContainEqual(expect.objectContaining({ type: 'done' }));
    });
  });

  describe('readingHelpCacheKey', () => {
    const fast = choiceFor('fast');

    it('is the same for the same inputs, whoever asks', () => {
      expect(readingHelpCacheKey(term(), fast)).toBe(readingHelpCacheKey(term(), fast));
      expect(readingHelpCacheKey(term({ fileId: 99 }), fast)).toBe(readingHelpCacheKey(term(), fast));
      expect(readingHelpCacheKey(term({ language: 'EN' }), fast)).toBe(readingHelpCacheKey(term(), fast));
    });

    it('changes with anything that shapes the answer', () => {
      const base = readingHelpCacheKey(term(), fast);
      const variants = [
        readingHelpCacheKey(term({ term: 'Bingley' }), fast),
        readingHelpCacheKey(term({ language: 'de' }), fast),
        readingHelpCacheKey(term({ scope: 'chapter' }), fast),
        readingHelpCacheKey(term({ kind: 'description' }), fast),
        readingHelpCacheKey(term({ passages: ['Mr Darcy walked in.'] }), fast),
        readingHelpCacheKey(term(), choiceFor('careful')),
        readingHelpCacheKey(term(), { ...fast, model: 'other-model' }),
        readingHelpCacheKey(term(), { ...fast, connectionId: 4 }),
      ];
      expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
    });
  });

  it('sweeps answers unused for half a year and keeps the rest within 64 MB', async () => {
    const { service, cache } = setup();
    await service.sweepCache();
    const [before, maxBytes] = cache.sweep.mock.calls[0] as unknown as [Date, number];
    expect(Date.now() - before.getTime()).toBeCloseTo(180 * 24 * 60 * 60 * 1000, -5);
    expect(maxBytes).toBe(64 * 1024 * 1024);
  });
});
