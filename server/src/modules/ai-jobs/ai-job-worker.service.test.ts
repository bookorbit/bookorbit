import { IDLE_POLL_INTERVAL_MS } from '../../common/utils/idle-poll';
import type { AiJobRow } from '../../db/schema';
import { AI_JOB_CHANGED, AiJobChanges, type AiJobChangeKind } from './ai-job-changes.service';
import type { AiArtifactValues, AiRunOutcome, AiStepTiming } from './ai-job-runner.service';
import { AiJobWorker } from './ai-job-worker.service';
import { AI_JOBS_LEASE_MS, AI_JOBS_RENEW_MS } from './ai-jobs.constants';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

const ARTIFACT = { format: 2, coverage: 0.95 } as unknown as AiArtifactValues;
const TIMING: AiStepTiming = {
  feature: 'fake',
  step: 'names',
  connectionId: 1,
  model: 'fast-model',
  units: 3,
  lanes: 3,
  durationMs: 900,
  jobId: 'job-1',
};

function makeWorker(
  outcome: AiRunOutcome | ((signal: AbortSignal) => Promise<AiRunOutcome>) = { kind: 'completed', artifact: ARTIFACT, timings: [] },
) {
  const h = createRunnerHarness();
  const queue: AiJobRow[] = [];
  const jobs = {
    hasDueJob: vi.fn<(feature: string) => Promise<boolean>>().mockResolvedValue(true),
    claimNext: vi.fn<(feature: string, owner: string, leaseMs: number, limit: number) => Promise<AiJobRow | null>>(() =>
      Promise.resolve(queue.shift() ?? null),
    ),
    renewLease: vi.fn(() => Promise.resolve(true)),
    complete: vi.fn((id: string) => Promise.resolve({ id, status: 'completed' } as AiJobRow)),
    pause: vi.fn((id: string) => Promise.resolve({ id, status: 'paused' } as AiJobRow)),
    fail: vi.fn((id: string, _owner: string, reason: string) => Promise.resolve({ id, status: 'failed', reason } as AiJobRow)),
  };
  const runner = {
    run: vi.fn((_row: AiJobRow, _owner: string, controller: AbortController) =>
      typeof outcome === 'function' ? outcome(controller.signal) : Promise.resolve(outcome),
    ),
  };
  const activity = { record: vi.fn(() => Promise.resolve()) };
  const notifier = { notify: vi.fn(() => Promise.resolve()) };
  const rates = { learn: vi.fn<(rows: readonly AiStepTiming[]) => Promise<void>>(() => Promise.resolve()) };
  const release = vi.spyOn(h.ports.budget, 'release');
  const changes = new AiJobChanges();
  const worker = new AiJobWorker(h.registry, jobs as never, runner as never, activity as never, notifier as never, rates as never, h.ports, changes);
  return { h, queue, jobs, runner, activity, notifier, rates, release, changes, worker };
}

function announce(changes: AiJobChanges, row: AiJobRow, kind: AiJobChangeKind): void {
  changes.changed({ id: row.id, feature: row.feature, subjectRef: row.subjectRef, requestedBy: row.requestedBy, kind });
}

function untilAborted(signal: AbortSignal): Promise<AiRunOutcome> {
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'stopped' }), { once: true }));
}

describe('AiJobWorker', () => {
  afterEach(() => vi.useRealTimers());

  it('backs off while nothing is due, skipping settings and claims, until a job changes state', async () => {
    const w = makeWorker();
    const settings = vi.spyOn(w.h.ports.settings, 'get');
    w.jobs.hasDueJob.mockResolvedValueOnce(false);

    await w.worker.tick();
    await w.worker.tick();
    expect(w.jobs.hasDueJob).toHaveBeenCalledOnce();
    expect(w.jobs.hasDueJob).toHaveBeenCalledWith(w.h.feature.id);
    expect(settings).not.toHaveBeenCalled();
    expect(w.jobs.claimNext).not.toHaveBeenCalled();

    const job = w.h.job();
    w.queue.push(job);
    announce(w.changes, job, 'progress');
    await w.worker.tick();
    expect(w.jobs.hasDueJob).toHaveBeenCalledOnce();

    announce(w.changes, job, 'state');
    await w.worker.tick();
    await w.worker.idle();
    expect(w.runner.run).toHaveBeenCalledOnce();
  });

  it('looks again unwoken once the idle wait has passed', async () => {
    vi.useFakeTimers();
    const w = makeWorker();
    w.jobs.hasDueJob.mockResolvedValueOnce(false);
    await w.worker.tick();

    await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS - 1);
    await w.worker.tick();
    expect(w.jobs.hasDueJob).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await w.worker.tick();
    expect(w.jobs.hasDueJob).toHaveBeenCalledTimes(2);
  });

  it('keeps the dispatch cadence while a due job waits for a free slot', async () => {
    const w = makeWorker();
    await w.worker.tick();
    await w.worker.tick();
    expect(w.jobs.hasDueJob).toHaveBeenCalledTimes(2);
    expect(w.jobs.claimNext).toHaveBeenCalledTimes(2);
  });

  it('stops listening for job changes on shutdown', async () => {
    const w = makeWorker();
    expect(w.changes.listenerCount(AI_JOB_CHANGED)).toBe(1);
    await w.worker.onApplicationShutdown();
    expect(w.changes.listenerCount(AI_JOB_CHANGED)).toBe(0);
  });

  it('claims until nothing is due, each claim under its own lease owner', async () => {
    const w = makeWorker();
    w.queue.push(w.h.job(), w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.jobs.claimNext).toHaveBeenCalledTimes(3);
    const owners = w.jobs.claimNext.mock.calls.map((call) => call[1]);
    expect(new Set(owners).size).toBe(3);
    expect(w.jobs.claimNext).toHaveBeenCalledWith(w.h.feature.id, expect.any(String), AI_JOBS_LEASE_MS, 1);
    expect(w.runner.run).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, 1],
    [2.7, 2],
    [10, 3],
  ])('clamps builds at once of %s to %s', async (setting, limit) => {
    const w = makeWorker();
    w.h.portsState.settings.buildsAtOnce = setting;
    await w.worker.tick();
    expect(w.jobs.claimNext).toHaveBeenCalledWith(w.h.feature.id, expect.any(String), AI_JOBS_LEASE_MS, limit);
  });

  it('completes, releases the budget and notifies once', async () => {
    const w = makeWorker();
    const row = w.h.job();
    w.queue.push(row);
    await w.worker.tick();
    await w.worker.idle();
    expect(w.jobs.complete).toHaveBeenCalledWith(row.id, expect.any(String), ARTIFACT);
    expect(w.activity.record).toHaveBeenCalledWith(row.id, 'info', null, 'completed', { coverage: 0.95 });
    expect(w.release).toHaveBeenCalledWith(row.id);
    expect(w.notifier.notify).toHaveBeenCalledTimes(1);
    expect(w.notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, status: 'completed' }), 'completed');
    expect(w.worker.runningJobIds).toEqual([]);
  });

  it('does nothing more when the job left this owner before it completed', async () => {
    const w = makeWorker({ kind: 'completed', artifact: ARTIFACT, timings: [TIMING] });
    w.jobs.complete.mockResolvedValueOnce(null as never);
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.rates.learn).not.toHaveBeenCalled();
    expect(w.release).not.toHaveBeenCalled();
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('learns the step timings of a completed job, and completes it even when they cannot be saved', async () => {
    const w = makeWorker({ kind: 'completed', artifact: ARTIFACT, timings: [TIMING] });
    w.rates.learn.mockRejectedValueOnce(new Error('db down'));
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.rates.learn).toHaveBeenCalledWith([TIMING]);
    expect(w.release).toHaveBeenCalled();
    expect(w.notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('pauses without notifying', async () => {
    const w = makeWorker({ kind: 'paused', reason: 'budget', detail: null });
    const row = w.h.job();
    w.queue.push(row);
    await w.worker.tick();
    await w.worker.idle();
    expect(w.jobs.pause).toHaveBeenCalledWith(row.id, expect.any(String), 'budget');
    expect(w.activity.record).toHaveBeenCalledWith(row.id, 'warn', null, 'paused', { reason: 'budget' });
    expect(w.release).not.toHaveBeenCalled();
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('records no pause when the job left this owner first', async () => {
    const w = makeWorker({ kind: 'paused', reason: 'off', detail: null });
    w.jobs.pause.mockResolvedValueOnce(null as never);
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.activity.record).not.toHaveBeenCalledWith(expect.anything(), 'warn', null, 'paused', expect.anything());
  });

  it('fails with the detail a manager may read, releases the budget and notifies once', async () => {
    const w = makeWorker({ kind: 'failed', reason: 'low-coverage', detail: 'names covered 80%', step: 'names' });
    const row = w.h.job();
    w.queue.push(row);
    await w.worker.tick();
    await w.worker.idle();
    expect(w.jobs.fail).toHaveBeenCalledWith(row.id, expect.any(String), 'low-coverage');
    expect(w.activity.record).toHaveBeenCalledWith(row.id, 'error', 'names', 'failed', { reason: 'low-coverage', detail: 'names covered 80%' });
    expect(w.release).toHaveBeenCalledWith(row.id);
    expect(w.notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('keeps the raw message of an unexpected error out of the job log', async () => {
    const w = makeWorker({ kind: 'failed', reason: 'error', detail: 'relation "x" does not exist', step: null });
    const row = w.h.job();
    w.queue.push(row);
    await w.worker.tick();
    await w.worker.idle();
    expect(w.activity.record).toHaveBeenCalledWith(row.id, 'error', null, 'failed', { reason: 'error' });
  });

  it('does nothing more when a failing job left this owner first', async () => {
    const w = makeWorker({ kind: 'failed', reason: 'requester', detail: null, step: null });
    w.jobs.fail.mockResolvedValueOnce(null as never);
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('records nothing for a stopped run', async () => {
    const w = makeWorker({ kind: 'stopped' });
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.jobs.complete).not.toHaveBeenCalled();
    expect(w.jobs.pause).not.toHaveBeenCalled();
    expect(w.jobs.fail).not.toHaveBeenCalled();
  });

  it('stops a run on request', async () => {
    const w = makeWorker(untilAborted);
    const row = w.h.job();
    w.queue.push(row);
    await w.worker.tick();
    expect(w.worker.runningJobIds).toEqual([row.id]);
    w.worker.stop(row.id);
    w.worker.stop('another-job');
    await w.worker.idle();
    expect(w.worker.runningJobIds).toEqual([]);
  });

  it('renews the lease while it works, and stops once the lease is lost', async () => {
    vi.useFakeTimers();
    const w = makeWorker(untilAborted);
    w.queue.push(w.h.job());
    await w.worker.tick();
    await vi.advanceTimersByTimeAsync(AI_JOBS_RENEW_MS);
    expect(w.jobs.renewLease).toHaveBeenCalledTimes(1);
    expect(w.worker.runningJobIds).toHaveLength(1);

    w.jobs.renewLease.mockRejectedValueOnce(new Error('connection reset'));
    await vi.advanceTimersByTimeAsync(AI_JOBS_RENEW_MS);
    expect(w.worker.runningJobIds).toHaveLength(1);

    w.jobs.renewLease.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(AI_JOBS_RENEW_MS);
    await w.worker.idle();
    expect(w.worker.runningJobIds).toEqual([]);
  });

  it('survives an outcome it could not record, leaving the job to lease recovery', async () => {
    const w = makeWorker();
    w.jobs.complete.mockRejectedValueOnce(new Error('database down'));
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.idle();
    expect(w.notifier.notify).not.toHaveBeenCalled();
    expect(w.worker.runningJobIds).toEqual([]);
  });

  it('survives a dispatch failure and dispatches again on the next tick', async () => {
    const w = makeWorker();
    w.jobs.claimNext.mockRejectedValueOnce(new Error('database down'));
    await expect(w.worker.tick()).resolves.toBeUndefined();
    await w.worker.tick();
    expect(w.jobs.claimNext).toHaveBeenCalledTimes(2);
  });

  it('runs one dispatch at a time', async () => {
    const w = makeWorker();
    let release!: () => void;
    w.jobs.claimNext.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(null))));
    const first = w.worker.tick();
    await vi.waitFor(() => expect(w.jobs.claimNext).toHaveBeenCalledTimes(1));
    await w.worker.tick();
    expect(w.jobs.claimNext).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('aborts its runs on shutdown and claims nothing after', async () => {
    const w = makeWorker(untilAborted);
    w.queue.push(w.h.job());
    await w.worker.tick();
    await w.worker.onApplicationShutdown();
    expect(w.worker.runningJobIds).toEqual([]);
    w.queue.push(w.h.job());
    await w.worker.tick();
    expect(w.jobs.claimNext).toHaveBeenCalledTimes(2);
  });
});
