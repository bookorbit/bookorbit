import { AiJobFailure, AiJobPause, AiUnitSkipped } from './ai-feature';
import { AiError, aiErrorCode, DISCONNECTED_AI_JOBS_PORTS } from './ai-jobs.ports';

describe('aiErrorCode', () => {
  it('reads the code of an AiError', () => {
    expect(aiErrorCode(new AiError('budget'))).toBe('budget');
  });

  it('recognises an AiError from another module by its shape', () => {
    const foreign = Object.assign(new Error('rate limited'), { name: 'AiError', code: 'provider-down' });
    expect(aiErrorCode(foreign)).toBe('provider-down');
  });

  it.each([
    ['an AiError-named error without a string code', Object.assign(new Error('x'), { name: 'AiError', code: 7 })],
    ['another error', new Error('boom')],
    ['a string', 'provider-down'],
    ['nothing', undefined],
  ])('is null for %s', (_label, value) => {
    expect(aiErrorCode(value)).toBeNull();
  });
});

describe('DISCONNECTED_AI_JOBS_PORTS', () => {
  it('reads every feature as switched off, with every slot missing', async () => {
    const ports = DISCONNECTED_AI_JOBS_PORTS;
    expect(await ports.settings.get('any')).toEqual({ enabled: false, buildsAtOnce: 1 });
    expect(await ports.slots.resolve('any', ['fast', 'careful'])).toEqual({ models: {}, missing: ['fast', 'careful'] });
    expect(await ports.health.check('any', {})).toBe('slot-empty');
    expect(await ports.health.retest('any', {})).toBe('slot-empty');
    expect(await ports.budget.reserve({ jobId: 'job', feature: 'any', amount: 1 })).toEqual({ ok: true });
    await expect(ports.budget.release('job')).resolves.toBeUndefined();
    await expect(ports.client.complete({} as never)).rejects.toMatchObject({ name: 'AiError', code: 'off' });
  });
});

describe('engine errors', () => {
  it('carry their reason, with the reason as the default message', () => {
    expect(new AiUnitSkipped('refused')).toMatchObject({ name: 'AiUnitSkipped', reason: 'refused', message: 'Unit left out: refused' });
    expect(new AiJobFailure('unreadable')).toMatchObject({ name: 'AiJobFailure', reason: 'unreadable', message: 'unreadable' });
    expect(new AiJobPause('budget', 'Over the monthly limit')).toMatchObject({
      name: 'AiJobPause',
      reason: 'budget',
      message: 'Over the monthly limit',
    });
    expect(new AiError('cancelled')).toMatchObject({ name: 'AiError', code: 'cancelled', message: 'cancelled' });
  });
});
