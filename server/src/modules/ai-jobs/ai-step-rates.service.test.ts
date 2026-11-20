import type { AiStepTimingRow } from '../../db/schema';
import { AI_STEP_RATES_TTL_MS, AiStepRates, AiStepRateTable } from './ai-step-rates.service';
import type { AiStepTimingRepository } from './ai-step-timing.repository';

let nextId = 1;

function row(overrides: Partial<AiStepTimingRow> = {}): AiStepTimingRow {
  return {
    id: nextId++,
    feature: 'story-guides',
    step: 'names',
    connectionId: 1,
    model: 'fast',
    effort: null,
    units: 10,
    lanes: 1,
    durationMs: 10_000,
    jobId: null,
    createdAt: new Date('2026-11-10T00:00:00Z'),
    ...overrides,
  };
}

function makeRates(rows: AiStepTimingRow[] = []) {
  const timings = {
    forFeature: vi.fn<(feature: string) => Promise<AiStepTimingRow[]>>(() => Promise.resolve(rows)),
    record: vi.fn<(rows: readonly unknown[]) => Promise<void>>(() => Promise.resolve()),
    remove: vi.fn<(key: unknown) => Promise<number>>(() => Promise.resolve(2)),
  };
  return { rates: new AiStepRates(timings as unknown as AiStepTimingRepository), timings };
}

describe('AiStepRateTable', () => {
  it('reads a unit in one lane as the median of the kept runs, per step, connection and model', () => {
    const table = new AiStepRateTable([
      row({ durationMs: 10_000, units: 10 }),
      row({ durationMs: 40_000, units: 10 }),
      row({ durationMs: 20_000, units: 10 }),
      // Twelve units side by side for a second: each took twelve seconds of one lane.
      row({ step: 'ties', durationMs: 10_000, units: 120, lanes: 12 }),
      row({ step: 'ties', durationMs: 30_000, units: 120, lanes: 12 }),
      row({ connectionId: 2, durationMs: 5_000, units: 1 }),
    ]);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'fast' })).toBe(2_000);
    expect(table.msPerUnit('ties', { connectionId: 1, model: 'fast' })).toBe(2_000);
    expect(table.msPerUnit('names', { connectionId: 2, model: 'fast' })).toBe(5_000);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'other' })).toBeNull();
    expect(table.msPerUnit('names', undefined)).toBeNull();
    expect(table.list().find((rate) => rate.step === 'names' && rate.connectionId === 1)).toMatchObject({ runs: 3 });
  });

  it('learns each effort level apart, and the level the feature chose as its own', () => {
    const table = new AiStepRateTable([
      row({ durationMs: 10_000, units: 10 }),
      row({ effort: 'high', durationMs: 60_000, units: 10 }),
      row({ effort: 'low', durationMs: 5_000, units: 10 }),
    ]);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'fast' })).toBe(1_000);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'fast', effort: 'high' })).toBe(6_000);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'fast', effort: 'low' })).toBe(500);
    expect(table.msPerUnit('names', { connectionId: 1, model: 'fast', effort: 'max' })).toBeNull();
    expect(table.list().map((rate) => rate.effort)).toEqual([null, 'high', 'low']);
  });

  it('dates a rate by its newest run', () => {
    const table = new AiStepRateTable([row({ createdAt: new Date('2026-11-01T00:00:00Z') }), row({ createdAt: new Date('2026-11-05T00:00:00Z') })]);
    expect(table.list()[0]!.learnedAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });
});

describe('AiStepRates', () => {
  afterEach(() => vi.useRealTimers());

  it('reads a feature once per window, and again after it', async () => {
    vi.useFakeTimers();
    const { rates, timings } = makeRates([row()]);
    await rates.table('story-guides');
    await rates.table('story-guides');
    expect(timings.forFeature).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AI_STEP_RATES_TTL_MS);
    await rates.table('story-guides');
    expect(timings.forFeature).toHaveBeenCalledTimes(2);
  });

  it('reads again at once after learning or forgetting something', async () => {
    const { rates, timings } = makeRates([row()]);
    await rates.table('story-guides');
    await rates.learn([row()]);
    await rates.table('story-guides');
    expect(timings.forFeature).toHaveBeenCalledTimes(2);
    expect(await rates.forget({ feature: 'story-guides', connectionId: 1, model: 'fast' })).toBe(2);
    await rates.table('story-guides');
    expect(timings.forFeature).toHaveBeenCalledTimes(3);
  });

  it('saves nothing for a job with no timings', async () => {
    const { rates, timings } = makeRates();
    await rates.learn([]);
    expect(timings.record).not.toHaveBeenCalled();
  });

  it('does not keep a failed read', async () => {
    const { rates, timings } = makeRates([row()]);
    timings.forFeature.mockRejectedValueOnce(new Error('db down'));
    await expect(rates.table('story-guides')).rejects.toThrow('db down');
    await expect(rates.table('story-guides')).resolves.toBeInstanceOf(AiStepRateTable);
    expect(timings.forFeature).toHaveBeenCalledTimes(2);
  });
});
