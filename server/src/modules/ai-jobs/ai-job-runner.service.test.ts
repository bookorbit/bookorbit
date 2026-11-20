import { gunzipSync } from 'zlib';

import { AiError, type AiRequest } from './ai-jobs.ports';
import { defaultAnswer, hangUntilAborted, type FakeArtifact } from './testing/fake-ai-feature';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

describe('AiJobRunner', () => {
  it('runs every step and assembles a gzipped artifact in the newest format', async () => {
    const h = createRunnerHarness();
    const row = h.job(3);
    const outcome = await h.run(row);
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    const artifact = JSON.parse(gunzipSync(outcome.artifact.payload).toString()) as FakeArtifact;
    expect(artifact).toEqual({
      format: 2,
      names: ['Person0', 'Place0', 'Person1', 'Place1', 'Person2', 'Place2'],
      summary: expect.stringContaining('Person0'),
      coverage: 1,
    });
    expect(outcome.artifact).toMatchObject({
      format: 2,
      generation: 1,
      coverage: 1,
      pipeline: h.feature.pipeline,
      size: outcome.artifact.payload.length,
    });
    expect(outcome.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.artifact.models).toEqual(h.portsState.models);
    expect(h.jobState.models).toEqual(h.portsState.models);
    expect(h.portsState.reserved.has(row.id)).toBe(true);
  });

  it('sends each request on the step slot for the job, and records its usage', async () => {
    const h = createRunnerHarness();
    const row = h.job(2);
    await h.run(row);
    expect(h.client.calls.map((call) => [call.slot, call.feature, call.jobId])).toEqual([
      ['fast', h.feature.id, row.id],
      ['fast', h.feature.id, row.id],
      ['careful', h.feature.id, row.id],
    ]);
    expect(h.client.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(h.client.calls.map((call) => call.use?.model)).toEqual(['fast-model', 'fast-model', 'careful-model']);
    expect(h.portsState.reservations).toEqual([{ jobId: row.id, feature: h.feature.id, amount: 0.01 }]);
    expect(h.jobState.usage).toEqual({ tokens: 360, costMicros: 300 });
    expect(h.saves.find((save) => save.step === 'names')).toBeDefined();
  });

  it('reports progress per step', async () => {
    const h = createRunnerHarness();
    await h.run(h.job(3));
    expect(h.jobState.progress.at(-1)).toEqual({ phase: 'summary', done: 1, total: 1 });
    expect(h.jobState.progress).toContainEqual({ phase: 'names', done: 3, total: 3 });
  });

  it('reuses every cached unit on a second run of the same job', async () => {
    const h = createRunnerHarness();
    const row = h.job(4);
    await h.run(row);
    const calls = h.client.calls.length;
    const runs = h.featureState.runs.length;
    const outcome = await h.run(row);
    expect(outcome.kind).toBe('completed');
    expect(h.client.calls).toHaveLength(calls);
    expect(h.featureState.runs).toHaveLength(runs);
    expect(h.events.filter((event) => event.code === 'step_finished').at(-1)?.data).toMatchObject({ reused: 1 });
  });

  it('times each model step on the units it sent itself, for the worker to save once the job completes', async () => {
    const h = createRunnerHarness();
    const row = h.job(3);
    const first = await h.run(row);
    if (first.kind !== 'completed') throw new Error(`expected completed, got ${first.kind}`);
    expect(first.timings).toEqual([
      {
        feature: h.feature.id,
        step: 'names',
        connectionId: 1,
        model: 'fast-model',
        effort: null,
        units: 3,
        lanes: 3,
        durationMs: expect.any(Number),
        jobId: row.id,
      },
      {
        feature: h.feature.id,
        step: 'summary',
        connectionId: 1,
        model: 'careful-model',
        effort: null,
        units: 1,
        lanes: 1,
        durationMs: expect.any(Number),
        jobId: row.id,
      },
    ]);
    // A second run reuses every unit, so it has nothing to time.
    const second = await h.run(row);
    expect(second.kind === 'completed' && second.timings).toEqual([]);
  });

  it('keeps the models a job recorded, even after a slot changes', async () => {
    const h = createRunnerHarness();
    const recorded = { fast: { connectionId: 9, model: 'old-fast' }, careful: { connectionId: 9, model: 'old-careful' } };
    const outcome = await h.run(h.job(2, { models: recorded }));
    expect(outcome.kind === 'completed' && outcome.artifact.models).toEqual(recorded);
    expect(h.jobState.models).toBeNull();
  });

  it('stops without an outcome once the job is no longer its to run', async () => {
    const h = createRunnerHarness();
    h.jobState.running = false;
    expect(await h.run(h.job(2))).toEqual({ kind: 'stopped' });
  });

  it('stops at once when its signal aborts mid-request', async () => {
    const h = createRunnerHarness();
    h.client.handler = (request) => hangUntilAborted(request);
    const controller = new AbortController();
    const pending = h.run(h.job(3), controller);
    await vi.waitFor(() => expect(h.client.calls.length).toBeGreaterThan(0));
    controller.abort();
    expect(await pending).toEqual({ kind: 'stopped' });
    expect(h.saves.filter((save) => save.step === 'names')).toHaveLength(0);
  });

  it('fails with error, naming the step, for an unexpected exception', async () => {
    const h = createRunnerHarness();
    h.client.handler = (request) => (request.slot === 'careful' ? Promise.reject(new Error('boom')) : defaultAnswer(request));
    expect(await h.run(h.job(2))).toEqual({ kind: 'failed', reason: 'error', detail: 'boom', step: 'summary' });
  });

  it('fails with error for an AiError code it does not know', async () => {
    const h = createRunnerHarness();
    h.client.handler = () => Promise.reject(new AiError('something-new'));
    expect(await h.run(h.job(2))).toMatchObject({ kind: 'failed', reason: 'error', step: 'names' });
  });

  it('fails when a step produces a unit id twice or one that is too long', async () => {
    const h = createRunnerHarness();
    const names = h.feature.steps[1]!;
    const original = names.units;
    names.units = () => [{ id: 'p0' }, { id: 'p0' }];
    expect(await h.run(h.job(2))).toMatchObject({ kind: 'failed', reason: 'error', step: 'names' });
    names.units = () => [{ id: 'x'.repeat(65) }];
    expect(await h.run(h.job(2))).toMatchObject({ kind: 'failed', reason: 'error', step: 'names' });
    names.units = original;
  });
});

describe('AiJobRunner outcomes for each client answer', () => {
  it.each(['off', 'slot-empty', 'budget', 'provider-auth', 'model-missing', 'provider-down'] as const)(
    'pauses %s without leaving any unit out',
    async (code) => {
      const h = createRunnerHarness();
      h.client.handler = () => Promise.reject(new AiError(code));
      expect(await h.run(h.job(3))).toMatchObject({ kind: 'paused', reason: code });
      expect(h.saves.filter((save) => save.value.outcome === 'skipped')).toHaveLength(0);
    },
  );

  it.each([
    ['a refusal', 'refused', (request: AiRequest) => ({ ...defaultAnswer(request), finish: 'refused' as const, json: undefined })],
    ['a filter', 'filtered', (request: AiRequest) => ({ ...defaultAnswer(request), finish: 'filtered' as const, json: undefined })],
    ['invalid JSON after the repair retry', 'invalid-json', () => Promise.reject(new AiError('invalid-json'))],
    ['a reply cut short at the split floor', 'too-long', () => Promise.reject(new AiError('too-long'))],
  ])('leaves a unit out for %s, records why, and counts it against coverage', async (_label, reason, answer) => {
    const h = createRunnerHarness();
    h.client.handler = (request) => (request.user.startsWith('Passage 0 ') ? answer(request) : defaultAnswer(request));
    const outcome = await h.run(h.job(10));
    expect(outcome).toMatchObject({ kind: 'completed', artifact: { coverage: 0.9 } });
    expect(h.saves.filter((save) => save.value.outcome === 'skipped')).toEqual([
      expect.objectContaining({ step: 'names', unit: 'p0', value: { outcome: 'skipped', reason } }),
    ]);
    expect(h.events).toContainEqual({ code: 'unit_skipped', step: 'names', data: { unit: 'p0', reason } });
  });

  it('fails low-coverage, naming the step, below 90% of its units', async () => {
    const h = createRunnerHarness();
    h.client.handler = (request) =>
      /^Passage [01] /.test(request.user) ? { ...defaultAnswer(request), finish: 'refused', json: undefined } : defaultAnswer(request);
    expect(await h.run(h.job(10))).toEqual({
      kind: 'failed',
      reason: 'low-coverage',
      detail: 'Step names finished 8 of 10 units',
      step: 'names',
    });
    expect(h.client.callsFor('careful')).toHaveLength(0);
  });

  it('neither fails nor lowers coverage for units an optional step could not finish', async () => {
    const h = createRunnerHarness();
    const names = h.feature.steps.find((step) => step.id === 'names');
    if (!names) throw new Error('expected a names step');
    names.optional = true;
    h.client.handler = (request) =>
      /^Passage [0-4] /.test(request.user) ? { ...defaultAnswer(request), finish: 'refused', json: undefined } : defaultAnswer(request);
    const outcome = await h.run(h.job(10));
    expect(outcome).toMatchObject({ kind: 'completed', artifact: { coverage: 1 } });
    expect(h.events).toContainEqual(
      expect.objectContaining({ code: 'step_finished', step: 'names', data: expect.objectContaining({ coverage: 0.5 }) }),
    );
  });

  it('stops for a cancelled request, and fails error for a bad request', async () => {
    const h = createRunnerHarness();
    h.client.handler = () => Promise.reject(new AiError('cancelled'));
    expect(await h.run(h.job(2))).toEqual({ kind: 'stopped' });
    h.client.handler = () => Promise.reject(new AiError('bad-request', 'unsupported parameter'));
    expect(await h.run(h.job(2))).toMatchObject({ kind: 'failed', reason: 'error', detail: 'unsupported parameter', step: 'names' });
  });
});
