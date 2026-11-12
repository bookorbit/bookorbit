import { AiJobPauses } from './ai-job-pauses.service';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

function makePauses() {
  const h = createRunnerHarness();
  const resolve = vi.spyOn(h.ports.slots, 'resolve');
  const check = vi.spyOn(h.ports.health, 'check');
  const retest = vi.spyOn(h.ports.health, 'retest');
  return { h, resolve, check, retest, pauses: new AiJobPauses(h.ports) };
}

describe('AiJobPauses.blocker', () => {
  it('holds an over-estimate pause until Continue, checking nothing', async () => {
    const p = makePauses();
    expect(await p.pauses.blocker(p.h.job(2, { status: 'paused', reason: 'over-estimate' }), p.h.feature, true)).toBe('over-estimate');
    expect(p.check).not.toHaveBeenCalled();
    expect(p.h.portsState.reservations).toEqual([]);
  });

  it('answers off while the feature is switched off', async () => {
    const p = makePauses();
    p.h.portsState.settings.enabled = false;
    expect(await p.pauses.blocker(p.h.job(2, { reason: 'budget' }), p.h.feature, false)).toBe('off');
  });

  it('answers slot-empty while a slot the job never recorded has no model', async () => {
    const p = makePauses();
    p.h.portsState.missing = ['careful'];
    const row = p.h.job(2, { reason: 'slot-empty', models: { fast: { connectionId: 1, model: 'fast-model' } } });
    expect(await p.pauses.blocker(row, p.h.feature, false)).toBe('slot-empty');
    expect(p.resolve).toHaveBeenCalledWith(p.h.feature.id, ['careful']);
  });

  it('checks the health of the models the job recorded, without resolving its slots again', async () => {
    const p = makePauses();
    const models = { fast: { connectionId: 3, model: 'a' }, careful: { connectionId: 3, model: 'b' } };
    p.h.portsState.health = 'provider-auth';
    expect(await p.pauses.blocker(p.h.job(2, { reason: 'provider-auth', models }), p.h.feature, false)).toBe('provider-auth');
    expect(p.resolve).not.toHaveBeenCalled();
    expect(p.check).toHaveBeenCalledWith(p.h.feature.id, models);
    expect(p.retest).not.toHaveBeenCalled();
  });

  it('tests the connections now for Try again', async () => {
    const p = makePauses();
    p.h.portsState.health = 'provider-down';
    p.h.portsState.retestHealth = null;
    expect(await p.pauses.blocker(p.h.job(2, { reason: 'provider-down' }), p.h.feature, true)).toBeNull();
    expect(p.retest).toHaveBeenCalled();
  });

  it('reserves the budget last, and answers budget when it does not fit', async () => {
    const p = makePauses();
    const row = p.h.job(2, { reason: 'budget' });
    p.h.portsState.budget = 'budget';
    expect(await p.pauses.blocker(row, p.h.feature, false)).toBe('budget');
    p.h.portsState.budget = 'ok';
    expect(await p.pauses.blocker(row, p.h.feature, false)).toBeNull();
    expect(p.h.portsState.reservations).toEqual([
      { jobId: row.id, feature: p.h.feature.id, amount: 0.01 },
      { jobId: row.id, feature: p.h.feature.id, amount: 0.01 },
    ]);
  });

  it('reserves nothing while another cause holds', async () => {
    const p = makePauses();
    p.h.portsState.health = 'model-missing';
    await p.pauses.blocker(p.h.job(2, { reason: 'budget', estimate: null }), p.h.feature, false);
    expect(p.h.portsState.reservations).toEqual([]);
  });
});
