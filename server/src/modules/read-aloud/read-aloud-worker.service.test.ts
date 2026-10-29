import { Logger } from '@nestjs/common';
import type { ReadAloudWorkerEvent, ReadAloudWorkerJob } from '@bookorbit/types';

import { GeneratedFileError } from '../upload/generated-book-file.service';
import { ReadAloudJobError } from './read-aloud-errors';
import { READ_ALOUD_MAX_ATTEMPTS, READ_ALOUD_MAX_RESUBMITS } from './read-aloud.constants';
import { ReadAloudWorkerService } from './read-aloud-worker.service';
import { WorkerJobNotFoundError, WorkerRejectedError, WorkerUnreachableError } from './read-aloud-worker-client.service';
import { COVERAGE, JOB_ID, jobRow, okHealth, OWNER, REPORT_TOTALS } from './test-helpers';

function workerJob(overrides: Partial<ReadAloudWorkerJob> = {}): ReadAloudWorkerJob {
  return {
    jobId: JOB_ID,
    status: 'running',
    stage: 'generating_emissions',
    progress: 40,
    stageDetail: { current: 2, total: 5, unit: 'track' },
    errorCode: null,
    error: null,
    outputBytes: null,
    events: [],
    ...overrides,
  };
}

function setup() {
  const claimed = jobRow({ status: 'processing', stage: 'preparing_audio', attemptCount: 1 });
  const jobs = {
    claimNext: vi.fn().mockResolvedValue(claimed),
    claimQueued: vi.fn().mockResolvedValue(claimed),
    findById: vi.fn().mockResolvedValue(null),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi
      .fn()
      .mockImplementation((_id: string, progress: { stage: string }) => Promise.resolve(jobRow({ status: 'processing', stage: progress.stage }))),
    isCancellationRequested: vi.fn().mockResolvedValue(false),
    advanceWorkerEventSeq: vi.fn().mockResolvedValue(undefined),
    beginPublishing: vi.fn().mockResolvedValue(jobRow({ status: 'processing', stage: 'publishing', progress: 99 })),
    markAwaitingReview: vi.fn().mockResolvedValue(jobRow({ status: 'awaiting_review' })),
    complete: vi.fn().mockResolvedValue(jobRow({ status: 'completed', outputFileId: 555 })),
    fail: vi
      .fn()
      .mockImplementation((_id: string, code: string) =>
        Promise.resolve(jobRow({ status: code === 'cancelled' ? 'cancelled' : 'failed', errorCode: code })),
      ),
    requeue: vi.fn().mockResolvedValue(jobRow({ status: 'queued' })),
  };
  const worker = {
    configured: true,
    healthState: vi.fn().mockResolvedValue(okHealth()),
    start: vi.fn().mockResolvedValue(workerJob({ status: 'queued', stage: 'preparing_audio', progress: 0, events: [] })),
    status: vi.fn(),
    cancel: vi.fn().mockResolvedValue(workerJob({ status: 'cancelled' })),
  };
  const readAloud = {
    resolveProcessingContext: vi.fn().mockResolvedValue({
      user: OWNER,
      request: {
        jobId: JOB_ID,
        epubPath: '/library/novel/novel.epub',
        audioPaths: ['/library/novel/01.mp3'],
        workDir: `/data/read-aloud/jobs/${JOB_ID}`,
      },
    }),
  };
  const publisher = {
    withHeartbeat: vi.fn().mockImplementation((_id: string, fn: () => Promise<unknown>) => fn()),
    validate: vi.fn().mockResolvedValue({ report: REPORT_TOTALS, coverage: COVERAGE, warnings: [], requiresReview: false, outputBytes: 10 }),
    publish: vi.fn().mockResolvedValue(555),
  };
  const workspace = { ensure: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
  const activity = { record: vi.fn().mockResolvedValue(undefined), recordWorkerEvents: vi.fn().mockResolvedValue(undefined) };
  const notifier = { pushUpdate: vi.fn().mockResolvedValue(undefined), notify: vi.fn().mockResolvedValue(undefined) };
  const service = new ReadAloudWorkerService(
    { maxOutputBytes: 1e9 } as never,
    jobs as never,
    worker as never,
    readAloud as never,
    publisher as never,
    workspace as never,
    activity as never,
    notifier as never,
  );
  const run = () => (service as unknown as { process(job: unknown, device: string): Promise<void> }).process(claimed, 'cpu');
  return { service, run, jobs, worker, readAloud, publisher, workspace, activity, notifier };
}

async function drive(promise: Promise<unknown>, stepMs = 2_000, maxSteps = 5_000): Promise<void> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  for (let step = 0; step < maxSteps && !settled; step++) await vi.advanceTimersByTimeAsync(stepMs);
  await promise;
}

describe('ReadAloudWorkerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows the worker to completion, stores its events, and publishes', async () => {
    const t = setup();
    t.worker.status
      .mockResolvedValueOnce(
        workerJob({
          events: [
            { seq: 1, at: new Date().toISOString(), level: 'info', stage: 'generating_emissions', code: 'stage_started', message: null, data: null },
          ],
        }),
      )
      .mockResolvedValueOnce(workerJob({ status: 'completed', stage: 'validating', progress: 100, events: [] }));
    await drive(t.run());

    expect(t.worker.status).toHaveBeenNthCalledWith(2, JOB_ID, 1);
    expect(t.activity.recordWorkerEvents).toHaveBeenCalledWith(JOB_ID, [expect.objectContaining({ seq: 1 })]);
    expect(t.jobs.updateProgress).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ stage: 'generating_emissions', stageDetail: { current: 2, total: 5, unit: 'track' } }),
    );
    expect(t.publisher.publish).toHaveBeenCalled();
    expect(t.jobs.complete).toHaveBeenCalledWith(JOB_ID, 555, REPORT_TOTALS, [], COVERAGE);
    expect(t.workspace.remove).toHaveBeenCalledWith(JOB_ID);
    expect(t.notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), 'ready');
  });

  it('stores only worker events it has not seen, across runs of the same job', async () => {
    const t = setup();
    const event = (seq: number) => ({
      seq,
      at: new Date().toISOString(),
      level: 'info' as const,
      stage: null,
      code: 'stage_started',
      message: null,
      data: null,
    });
    const resumed = jobRow({ status: 'processing', stage: 'aligning', attemptCount: 1, workerEventSeq: 5 });
    t.worker.start.mockResolvedValue(workerJob({ events: [event(4), event(5), event(6)] }));
    t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed', events: [] }));
    await drive((t.service as unknown as { process(job: unknown, device: string): Promise<void> }).process(resumed, 'cpu'));

    expect(t.activity.recordWorkerEvents).toHaveBeenCalledTimes(1);
    expect(t.activity.recordWorkerEvents).toHaveBeenCalledWith(JOB_ID, [expect.objectContaining({ seq: 6 })]);
    expect(t.worker.status).toHaveBeenCalledWith(JOB_ID, 6);
  });

  it('holds low-quality output for review instead of publishing it', async () => {
    const t = setup();
    t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed' }));
    t.publisher.validate.mockResolvedValue({
      report: REPORT_TOTALS,
      coverage: COVERAGE,
      warnings: ['unmatched_text'],
      requiresReview: true,
      outputBytes: 10,
    });
    await drive(t.run());

    expect(t.jobs.markAwaitingReview).toHaveBeenCalledWith(JOB_ID, REPORT_TOTALS, ['unmatched_text'], COVERAGE, expect.any(Date));
    expect(t.publisher.publish).not.toHaveBeenCalled();
    expect(t.workspace.remove).not.toHaveBeenCalled();
    expect(t.notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_review' }), 'needs_review');
  });

  it('publishes output someone already chose to add when a restart sent it back through the worker', async () => {
    const t = setup();
    t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed' }));
    t.publisher.validate.mockResolvedValue({
      report: REPORT_TOTALS,
      coverage: COVERAGE,
      warnings: ['unmatched_text'],
      requiresReview: true,
      outputBytes: 10,
    });
    const approved = jobRow({ status: 'processing', stage: 'preparing_audio', attemptCount: 1, publishApproved: true });
    await drive((t.service as unknown as { process(job: unknown, device: string): Promise<void> }).process(approved, 'cpu'));

    expect(t.jobs.markAwaitingReview).not.toHaveBeenCalled();
    expect(t.publisher.publish).toHaveBeenCalled();
    expect(t.jobs.complete).toHaveBeenCalledWith(JOB_ID, 555, REPORT_TOTALS, ['unmatched_text'], COVERAGE);
    expect(t.notifier.notify).not.toHaveBeenCalledWith(expect.anything(), 'needs_review');
  });

  it('reports a full library volume as such when publishing fails', async () => {
    const t = setup();
    t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed' }));
    t.publisher.publish.mockRejectedValue(new GeneratedFileError('insufficient_storage', 'Not enough free space in the library folder'));
    await drive(t.run());

    expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'insufficient_storage', expect.any(String), expect.any(Date));
  });

  it('re-submits once when the worker forgot the job, so it resumes from cached work', async () => {
    const t = setup();
    t.worker.status.mockRejectedValueOnce(new WorkerJobNotFoundError(JOB_ID)).mockResolvedValueOnce(workerJob({ status: 'completed' }));
    t.worker.start.mockResolvedValue(workerJob());
    await drive(t.run());

    expect(t.worker.start).toHaveBeenCalledTimes(2);
    expect(t.activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', expect.anything(), 'worker_lost_job', expect.any(String));
    expect(t.jobs.complete).toHaveBeenCalled();
  });

  it('rides out a worker that restarts several times during one long run', async () => {
    const t = setup();
    t.worker.status
      .mockRejectedValueOnce(new WorkerJobNotFoundError(JOB_ID))
      .mockRejectedValueOnce(new WorkerJobNotFoundError(JOB_ID))
      .mockResolvedValueOnce(workerJob({ status: 'completed' }));
    t.worker.start.mockResolvedValue(workerJob());
    await drive(t.run());

    expect(t.worker.start).toHaveBeenCalledTimes(3);
    expect(t.jobs.fail).not.toHaveBeenCalled();
    expect(t.jobs.complete).toHaveBeenCalled();
  });

  it('requeues instead of failing once the worker keeps losing the job', async () => {
    const t = setup();
    t.worker.status.mockRejectedValue(new WorkerJobNotFoundError(JOB_ID));
    t.worker.start.mockResolvedValue(workerJob());
    await drive(t.run());

    expect(t.worker.start).toHaveBeenCalledTimes(1 + READ_ALOUD_MAX_RESUBMITS);
    expect(t.jobs.requeue).toHaveBeenCalledWith(JOB_ID, expect.any(Date), 'worker_unavailable', 'The worker kept losing the job');
    expect(t.jobs.fail).not.toHaveBeenCalled();
    expect(t.workspace.remove).not.toHaveBeenCalled();
  });

  it('waits out a worker that stops answering for a while, without failing the job', async () => {
    const t = setup();
    t.worker.status
      .mockRejectedValueOnce(new WorkerUnreachableError('timeout'))
      .mockRejectedValueOnce(new WorkerUnreachableError('timeout'))
      .mockResolvedValueOnce(workerJob({ status: 'completed' }));
    await drive(t.run());

    expect(t.activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', expect.anything(), 'waiting_for_worker', expect.any(String));
    expect(t.activity.record).toHaveBeenCalledWith(JOB_ID, 'info', expect.anything(), 'worker_reachable_again', null, expect.any(Object));
    expect(t.jobs.fail).not.toHaveBeenCalled();
    expect(t.jobs.complete).toHaveBeenCalled();
  });

  it('requeues the job when the worker stays away past the window', async () => {
    const t = setup();
    t.worker.status.mockRejectedValue(new WorkerUnreachableError('timeout'));
    await drive(t.run(), 60_000);

    expect(t.jobs.requeue).toHaveBeenCalledWith(JOB_ID, expect.any(Date), 'worker_unavailable', expect.any(String));
    expect(t.jobs.fail).not.toHaveBeenCalled();
    expect(t.workspace.remove).not.toHaveBeenCalled();
  });

  it('fails with the worker’s own code and keeps the work for a retry', async () => {
    const t = setup();
    t.worker.status.mockResolvedValueOnce(workerJob({ status: 'failed', errorCode: 'inference_failed', error: 'onnx exploded' }));
    await drive(t.run());

    expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'inference_failed', 'onnx exploded', expect.any(Date));
    expect(t.workspace.remove).not.toHaveBeenCalled();
    expect(t.notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), 'failed');
  });

  it('drops the work for failures a retry cannot fix', async () => {
    const t = setup();
    t.worker.start.mockRejectedValue(new WorkerRejectedError('invalid_source', 'not a regular file'));
    await drive(t.run());
    expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'invalid_source', 'not a regular file', null);
    expect(t.workspace.remove).toHaveBeenCalledWith(JOB_ID);

    const gone = setup();
    gone.readAloud.resolveProcessingContext.mockRejectedValue(new ReadAloudJobError('source_missing', 'A selected source file no longer exists'));
    await drive(gone.run());
    expect(gone.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'source_missing', expect.any(String), null);
    expect(gone.workspace.remove).toHaveBeenCalledWith(JOB_ID);

    const changed = setup();
    changed.readAloud.resolveProcessingContext.mockRejectedValue(new ReadAloudJobError('source_changed', 'changed'));
    await drive(changed.run());
    expect(changed.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'source_changed', 'changed', null);
    expect(changed.worker.start).not.toHaveBeenCalled();
  });

  it.each(['library_not_mounted', 'source_missing'] as const)(
    'keeps the work for a retry when the worker briefly cannot see the library (%s)',
    async (code) => {
      const t = setup();
      t.worker.start.mockRejectedValue(new WorkerRejectedError(code, 'The audio file 1 does not exist'));
      await drive(t.run());

      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, code, expect.any(String), expect.any(Date));
      expect(t.workspace.remove).not.toHaveBeenCalled();
    },
  );

  it('stops the worker when the user cancels mid-run', async () => {
    const t = setup();
    t.worker.status.mockResolvedValue(workerJob());
    t.jobs.isCancellationRequested.mockResolvedValueOnce(false).mockResolvedValue(true);
    await drive(t.run());

    expect(t.worker.cancel).toHaveBeenCalledWith(JOB_ID);
    expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'cancelled', expect.any(String), null);
    expect(t.workspace.remove).toHaveBeenCalledWith(JOB_ID);
    expect(t.notifier.notify).not.toHaveBeenCalled();
  });

  describe('a worker that stops a job on its own', () => {
    it('requeues the job and keeps its work when the worker cancels it while shutting down', async () => {
      const t = setup();
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'cancelled', errorCode: 'cancelled', error: 'The job was cancelled' }));
      await drive(t.run());

      expect(t.jobs.requeue).toHaveBeenCalledWith(JOB_ID, expect.any(Date), 'worker_unavailable', expect.stringContaining('shutting down'));
      expect(t.jobs.fail).not.toHaveBeenCalled();
      expect(t.workspace.remove).not.toHaveBeenCalled();
      expect(t.worker.cancel).not.toHaveBeenCalled();
      expect(t.notifier.notify).not.toHaveBeenCalled();
      expect(t.activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', null, 'requeued', expect.any(String), expect.objectContaining({ attempt: 1 }));
    });

    it('fails a job whose worker keeps stopping once every attempt is used, still keeping its work for a retry', async () => {
      const t = setup();
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'cancelled' }));
      const lastAttempt = jobRow({ status: 'processing', stage: 'generating_emissions', attemptCount: READ_ALOUD_MAX_ATTEMPTS });
      await drive((t.service as unknown as { process(job: unknown, device: string): Promise<void> }).process(lastAttempt, 'cpu'));

      expect(t.jobs.requeue).not.toHaveBeenCalled();
      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'worker_unavailable', expect.any(String), expect.any(Date));
      expect(t.workspace.remove).not.toHaveBeenCalled();
    });

    it('still ends the job when the user had asked for the cancel the worker reports', async () => {
      const t = setup();
      // The loop's own check runs before the cancel lands; the worker then reports the job stopped.
      t.jobs.isCancellationRequested.mockResolvedValueOnce(false).mockResolvedValue(true);
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'cancelled' }));
      await drive(t.run());

      expect(t.jobs.requeue).not.toHaveBeenCalled();
      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'cancelled', expect.any(String), null);
      expect(t.workspace.remove).toHaveBeenCalledWith(JOB_ID);
    });
  });

  describe('a cancel that lands after the worker finished', () => {
    it('stops the job before anything reaches the library', async () => {
      const t = setup();
      let cancelled = false;
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed', stage: 'validating', progress: 100 }));
      t.publisher.validate.mockImplementation(() => {
        cancelled = true;
        return Promise.resolve({ report: REPORT_TOTALS, coverage: COVERAGE, warnings: [], requiresReview: false, outputBytes: 10 });
      });
      t.jobs.isCancellationRequested.mockImplementation(() => Promise.resolve(cancelled));
      t.jobs.beginPublishing.mockImplementation(() => Promise.resolve(cancelled ? null : jobRow({ status: 'processing', stage: 'publishing' })));
      await drive(t.run());

      expect(t.jobs.beginPublishing).toHaveBeenCalledWith(JOB_ID);
      expect(t.publisher.publish).not.toHaveBeenCalled();
      expect(t.jobs.complete).not.toHaveBeenCalled();
      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'cancelled', expect.any(String), null);
      expect(t.workspace.remove).toHaveBeenCalledWith(JOB_ID);
      expect(t.notifier.notify).not.toHaveBeenCalled();
    });

    it('publishes through the guarded transition when nobody cancelled', async () => {
      const t = setup();
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed' }));
      await drive(t.run());

      expect(t.jobs.beginPublishing).toHaveBeenCalledWith(JOB_ID);
      expect(t.notifier.pushUpdate).toHaveBeenCalledWith(expect.objectContaining({ stage: 'publishing' }));
      expect(t.jobs.updateProgress).not.toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ stage: 'publishing' }));
      expect(t.publisher.publish.mock.invocationCallOrder[0]).toBeGreaterThan(t.jobs.beginPublishing.mock.invocationCallOrder[0]!);
    });
  });

  describe('a job that already left processing', () => {
    it('leaves the work folder alone when lease recovery got to the job first', async () => {
      const t = setup();
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed' }));
      t.jobs.beginPublishing.mockResolvedValue(null);
      t.jobs.fail.mockResolvedValue(null);
      await drive(t.run());

      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'cancelled', expect.any(String), null);
      expect(t.workspace.remove).not.toHaveBeenCalled();
      expect(t.activity.record).not.toHaveBeenCalledWith(JOB_ID, 'info', null, 'cancelled');
    });

    it('leaves the work folder alone for a permanent failure the row no longer reflects', async () => {
      const t = setup();
      t.worker.start.mockRejectedValue(new WorkerRejectedError('invalid_source', 'not a regular file'));
      t.jobs.fail.mockResolvedValue(null);
      await drive(t.run());

      expect(t.jobs.fail).toHaveBeenCalledWith(JOB_ID, 'invalid_source', 'not a regular file', null);
      expect(t.workspace.remove).not.toHaveBeenCalled();
    });
  });

  describe('worker event bookkeeping', () => {
    const event = (seq: number, code = 'stage_started'): ReadAloudWorkerEvent => ({
      seq,
      at: new Date().toISOString(),
      level: 'info',
      stage: null,
      code,
      message: null,
      data: null,
    });

    it('saves the sequence of the events a final state carried', async () => {
      const t = setup();
      t.worker.start.mockResolvedValue(workerJob({ events: [event(1)] }));
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed', events: [event(2), event(3, 'job_completed')] }));
      await drive(t.run());

      expect(t.activity.recordWorkerEvents).toHaveBeenLastCalledWith(JOB_ID, [
        expect.objectContaining({ seq: 2 }),
        expect.objectContaining({ seq: 3 }),
      ]);
      expect(t.jobs.advanceWorkerEventSeq).toHaveBeenCalledWith(JOB_ID, 3);
    });

    it('does not save a sequence when the final state brought nothing new', async () => {
      const t = setup();
      t.worker.start.mockResolvedValue(workerJob({ events: [event(1)] }));
      t.worker.status.mockResolvedValueOnce(workerJob({ status: 'completed', events: [] }));
      await drive(t.run());

      expect(t.jobs.updateProgress).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ workerEventSeq: 1 }));
      expect(t.jobs.advanceWorkerEventSeq).not.toHaveBeenCalled();
    });

    it('stores every worker event exactly once across a run and its re-sync', async () => {
      const t = setup();
      let savedSeq = 0;
      const save = (seq: number | undefined) => {
        if (seq !== undefined) savedSeq = Math.max(savedSeq, seq);
      };
      t.jobs.updateProgress.mockImplementation((_id: string, progress: { stage: string; workerEventSeq?: number }) => {
        save(progress.workerEventSeq);
        return Promise.resolve(jobRow({ status: 'processing', stage: progress.stage }));
      });
      t.jobs.advanceWorkerEventSeq.mockImplementation((_id: string, seq: number) => {
        save(seq);
        return Promise.resolve();
      });
      // Like the real worker: one numbering per job, and the whole history kept across its runs.
      const history: ReadAloudWorkerEvent[] = [];
      const emit = (code: string) => history.push(event(history.length + 1, code));
      t.worker.start.mockImplementation(() => {
        emit('job_accepted');
        return Promise.resolve(workerJob({ events: [...history] }));
      });
      t.worker.status.mockImplementation((_id: string, afterSeq: number) => {
        emit('job_completed');
        return Promise.resolve(workerJob({ status: 'completed', events: history.filter((item) => item.seq > afterSeq) }));
      });
      const processJob = (row: unknown) => (t.service as unknown as { process(job: unknown, device: string): Promise<void> }).process(row, 'cpu');

      await drive(processJob(jobRow({ status: 'processing', stage: 'preparing_audio', attemptCount: 1, workerEventSeq: savedSeq })));
      await drive(processJob(jobRow({ status: 'processing', stage: 'aligning', attemptCount: 1, workerEventSeq: savedSeq, resumeFrom: 'aligning' })));

      const stored = t.activity.recordWorkerEvents.mock.calls.flatMap(([, events]) => (events as ReadAloudWorkerEvent[]).map((item) => item.seq));
      expect(stored).toEqual([1, 2, 3, 4]);
    });
  });

  it('logs, rather than leaks, a failure it cannot record, and frees the dispatch slot', async () => {
    const t = setup();
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      t.worker.status.mockResolvedValue(workerJob({ status: 'failed', errorCode: 'inference_failed', error: 'onnx exploded' }));
      t.jobs.fail.mockRejectedValue(new Error('database is down'));
      await t.service.tick();
      expect(t.service.currentJobId).toBe(JOB_ID);
      for (let step = 0; step < 50 && t.service.currentJobId !== null; step++) await vi.advanceTimersByTimeAsync(2_000);

      expect(t.service.currentJobId).toBeNull();
      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^\[read_aloud\.process_job\] \[fail\] jobId=.* error="database is down"/));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      errors.mockRestore();
    }
  });

  it('only claims work when the worker is reachable and speaks its protocol', async () => {
    const t = setup();
    t.worker.healthState.mockResolvedValue({ state: 'incompatible', health: okHealth().health });
    await t.service.tick();
    expect(t.jobs.claimNext).not.toHaveBeenCalled();
  });

  describe('when the worker is already running a job after this server restarted', () => {
    const RUNNING = '00000000-0000-4000-8000-0000000000aa';

    it('takes that job back instead of offering the busy worker another', async () => {
      const t = setup();
      t.worker.healthState.mockResolvedValue(okHealth({ activeJobId: RUNNING }));
      t.jobs.findById.mockResolvedValue(jobRow({ id: RUNNING, status: 'queued' }));
      t.jobs.claimQueued.mockResolvedValue(null);
      await t.service.tick();

      expect(t.jobs.claimQueued).toHaveBeenCalledWith(RUNNING);
      expect(t.jobs.claimNext).not.toHaveBeenCalled();
    });

    it('waits while that job is still under its old lease', async () => {
      const t = setup();
      t.worker.healthState.mockResolvedValue(okHealth({ activeJobId: RUNNING }));
      t.jobs.findById.mockResolvedValue(jobRow({ id: RUNNING, status: 'processing' }));
      await t.service.tick();

      expect(t.jobs.claimQueued).not.toHaveBeenCalled();
      expect(t.jobs.claimNext).not.toHaveBeenCalled();
      expect(t.worker.cancel).not.toHaveBeenCalled();
    });

    it.each([
      ['no longer exists', null],
      ['already ended', jobRow({ id: RUNNING, status: 'cancelled' })],
    ])('stops a job that %s', async (_label, row) => {
      const t = setup();
      t.worker.healthState.mockResolvedValue(okHealth({ activeJobId: RUNNING }));
      t.jobs.findById.mockResolvedValue(row);
      await t.service.tick();

      expect(t.worker.healthState).toHaveBeenLastCalledWith(true);
      expect(t.worker.cancel).toHaveBeenCalledWith(RUNNING);
      expect(t.jobs.claimNext).not.toHaveBeenCalled();
    });

    it('moves on to the queue when the busy job was only in a stale health answer', async () => {
      const t = setup();
      t.worker.healthState.mockResolvedValueOnce(okHealth({ activeJobId: RUNNING })).mockResolvedValue(okHealth());
      t.jobs.findById.mockResolvedValue(jobRow({ id: RUNNING, status: 'completed' }));
      await t.service.tick();

      expect(t.worker.cancel).not.toHaveBeenCalled();
      expect(t.jobs.claimNext).toHaveBeenCalled();
    });
  });
});
