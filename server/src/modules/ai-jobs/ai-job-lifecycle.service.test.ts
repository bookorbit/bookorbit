import type { AiJobRow } from '../../db/schema';
import { AiJobLifecycle } from './ai-job-lifecycle.service';
import { AI_JOBS_MAX_ATTEMPTS, AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS, AI_JOBS_STEP_CACHE_TTL_MS } from './ai-jobs.constants';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

function makeLifecycle() {
  const h = createRunnerHarness();
  const jobs = {
    recoverExpiredLeases: vi.fn(() => Promise.resolve({ requeued: [] as unknown[], failed: [] as unknown[] })),
    listResumable: vi.fn<(features: readonly string[], limit: number) => Promise<AiJobRow[]>>(() => Promise.resolve([])),
    resumePaused: vi.fn((id: string) => Promise.resolve({ id, status: 'queued' } as AiJobRow)),
    failPaused: vi.fn((id: string) => Promise.resolve({ id, status: 'failed', reason: 'provider-down' } as AiJobRow)),
  };
  const steps = { removeUnused: vi.fn(() => Promise.resolve(0)) };
  const pauses = { blocker: vi.fn((): Promise<string | null> => Promise.resolve(null)) };
  const activity = { record: vi.fn(() => Promise.resolve()) };
  const notifier = { notify: vi.fn(() => Promise.resolve()) };
  const release = vi.spyOn(h.ports.budget, 'release');
  const lifecycle = new AiJobLifecycle(h.registry, jobs as never, steps as never, pauses as never, activity as never, notifier as never, h.ports);
  return { h, jobs, steps, pauses, activity, notifier, release, lifecycle };
}

describe('AiJobLifecycle.recoverExpired', () => {
  it('logs a requeued job as recovered, at the step it was on', async () => {
    const l = makeLifecycle();
    const row = l.h.job(2, { phase: 'names', attempts: 2 });
    l.jobs.recoverExpiredLeases.mockResolvedValueOnce({ requeued: [row], failed: [] });
    await l.lifecycle.onApplicationBootstrap();
    expect(l.jobs.recoverExpiredLeases).toHaveBeenCalledWith(AI_JOBS_MAX_ATTEMPTS);
    expect(l.activity.record).toHaveBeenCalledWith(row.id, 'warn', 'names', 'recovered', { attempt: 2 });
    expect(l.notifier.notify).not.toHaveBeenCalled();
  });

  it('fails a job its server stopped too often: logs it, releases its budget and notifies once', async () => {
    const l = makeLifecycle();
    const row = l.h.job(2, { status: 'failed', reason: 'error', attempts: AI_JOBS_MAX_ATTEMPTS });
    l.jobs.recoverExpiredLeases.mockResolvedValueOnce({ requeued: [], failed: [row] });
    await l.lifecycle.recoverExpired();
    expect(l.activity.record).toHaveBeenCalledWith(row.id, 'error', null, 'failed', {
      reason: 'error',
      detail: `The server stopped during this job ${AI_JOBS_MAX_ATTEMPTS} times`,
    });
    expect(l.release).toHaveBeenCalledWith(row.id);
    expect(l.notifier.notify).toHaveBeenCalledTimes(1);
    expect(l.notifier.notify).toHaveBeenCalledWith(row, 'failed');
  });

  it('notifies even when releasing the budget fails', async () => {
    const l = makeLifecycle();
    l.release.mockRejectedValueOnce(new Error('ledger down'));
    l.jobs.recoverExpiredLeases.mockResolvedValueOnce({ requeued: [], failed: [l.h.job()] });
    await l.lifecycle.recoverExpired();
    expect(l.notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('survives a database failure', async () => {
    const l = makeLifecycle();
    l.jobs.recoverExpiredLeases.mockRejectedValueOnce(new Error('database down'));
    await expect(l.lifecycle.recoverExpired()).resolves.toBeUndefined();
  });
});

describe('AiJobLifecycle.sweep', () => {
  it('removes cached units unused for 30 days, in batches until a batch comes back short', async () => {
    const l = makeLifecycle();
    l.steps.removeUnused.mockResolvedValueOnce(5_000).mockResolvedValueOnce(5_000).mockResolvedValueOnce(12);
    const started = Date.now();
    await l.lifecycle.sweep();
    expect(l.steps.removeUnused).toHaveBeenCalledTimes(3);
    const [before, limit] = l.steps.removeUnused.mock.calls[0] as unknown as [Date, number];
    expect(limit).toBe(5_000);
    expect(started - AI_JOBS_STEP_CACHE_TTL_MS - before.getTime()).toBeLessThanOrEqual(0);
    expect(Date.now() - AI_JOBS_STEP_CACHE_TTL_MS - before.getTime()).toBeGreaterThanOrEqual(0);
  });

  it('stops after twenty batches, leaving the rest to the next sweep', async () => {
    const l = makeLifecycle();
    l.steps.removeUnused.mockResolvedValue(5_000);
    await l.lifecycle.sweep();
    expect(l.steps.removeUnused).toHaveBeenCalledTimes(20);
  });

  it('survives a database failure', async () => {
    const l = makeLifecycle();
    l.steps.removeUnused.mockRejectedValueOnce(new Error('database down'));
    await expect(l.lifecycle.sweep()).resolves.toBeUndefined();
  });
});

describe('AiJobLifecycle.resumePaused', () => {
  it('resumes a paused job whose cause cleared, reading the last known health', async () => {
    const l = makeLifecycle();
    const row = l.h.job(2, { status: 'paused', reason: 'budget', pausedAt: new Date() });
    l.jobs.listResumable.mockResolvedValueOnce([row]);
    await l.lifecycle.resumePaused();
    expect(l.jobs.listResumable).toHaveBeenCalledWith([l.h.feature.id], 200);
    expect(l.pauses.blocker).toHaveBeenCalledWith(row, l.h.feature, false);
    expect(l.jobs.resumePaused).toHaveBeenCalledWith(row.id);
    expect(l.activity.record).toHaveBeenCalledWith(row.id, 'info', null, 'resumed', { reason: 'budget', by: 'auto' });
  });

  it('leaves a job whose cause still holds, or whose feature this server does not run', async () => {
    const l = makeLifecycle();
    l.pauses.blocker.mockResolvedValueOnce('provider-auth');
    l.jobs.listResumable.mockResolvedValueOnce([
      l.h.job(2, { status: 'paused', reason: 'provider-auth', pausedAt: new Date() }),
      l.h.job(2, { status: 'paused', reason: 'off', pausedAt: new Date(), feature: 'gone' }),
    ]);
    await l.lifecycle.resumePaused();
    expect(l.jobs.resumePaused).not.toHaveBeenCalled();
  });

  it('records nothing when the job moved before it could resume', async () => {
    const l = makeLifecycle();
    l.jobs.resumePaused.mockResolvedValueOnce(null as never);
    l.jobs.listResumable.mockResolvedValueOnce([l.h.job(2, { status: 'paused', reason: 'off', pausedAt: new Date() })]);
    await l.lifecycle.resumePaused();
    expect(l.activity.record).not.toHaveBeenCalled();
  });

  it('fails a job the provider kept unreachable for a day, releasing its budget and notifying once', async () => {
    const l = makeLifecycle();
    const row = l.h.job(2, { status: 'paused', reason: 'provider-down', pausedAt: new Date(Date.now() - AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS - 1) });
    l.jobs.listResumable.mockResolvedValueOnce([row]);
    await l.lifecycle.resumePaused();
    expect(l.jobs.failPaused).toHaveBeenCalledWith(row.id, 'provider-down');
    expect(l.release).toHaveBeenCalledWith(row.id);
    expect(l.notifier.notify).toHaveBeenCalledTimes(1);
    expect(l.pauses.blocker).not.toHaveBeenCalled();
  });

  it('does not notify when the job moved before it could fail', async () => {
    const l = makeLifecycle();
    l.jobs.failPaused.mockResolvedValueOnce(null as never);
    const old = new Date(Date.now() - AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS - 1);
    l.jobs.listResumable.mockResolvedValueOnce([l.h.job(2, { status: 'paused', reason: 'provider-down', pausedAt: old })]);
    await l.lifecycle.resumePaused();
    expect(l.notifier.notify).not.toHaveBeenCalled();
  });

  it('keeps going past a job that throws, and past a failed listing', async () => {
    const l = makeLifecycle();
    l.pauses.blocker.mockRejectedValueOnce(new Error('connection test crashed'));
    const [first, second] = [
      l.h.job(2, { status: 'paused', reason: 'off', pausedAt: new Date() }),
      l.h.job(2, { status: 'paused', reason: 'off', pausedAt: new Date() }),
    ];
    l.jobs.listResumable.mockResolvedValueOnce([first, second]);
    await l.lifecycle.resumePaused();
    expect(l.jobs.resumePaused).toHaveBeenCalledTimes(1);
    expect(l.jobs.resumePaused).toHaveBeenCalledWith(second.id);

    l.jobs.listResumable.mockRejectedValueOnce(new Error('database down'));
    await expect(l.lifecycle.resumePaused()).resolves.toBeUndefined();
  });

  it('runs one pass at a time', async () => {
    const l = makeLifecycle();
    let release!: (rows: AiJobRow[]) => void;
    l.jobs.listResumable.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = l.lifecycle.resumePaused();
    await l.lifecycle.resumePaused();
    expect(l.jobs.listResumable).toHaveBeenCalledTimes(1);
    release([]);
    await first;
  });
});
