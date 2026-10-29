import type { BulkLookupOutcome } from '../chapter-editor/chapter-editor.service';
import { ChapterLookupWorker } from './chapter-lookup.worker';

type Job = { bookId: number; userId: number | null; attemptCount: number };

const APPLIED: BulkLookupOutcome = {
  status: 'applied',
  reason: null,
  result: { provider: 'audible', chapterCount: 12, runtimeMs: 37_206_520, totalDurationMs: 37_197_419, isAccurate: true },
};

function setup(options: { jobs?: Job[]; nodeEnv?: string } = {}) {
  const jobs = (options.jobs ?? []).map((job) => ({ ...job, claimToken: 'claim' }));
  const repo = {
    requeueProcessing: vi.fn().mockResolvedValue(undefined),
    claimNext: vi.fn().mockImplementation(() => Promise.resolve(jobs.shift() ?? null)),
    finish: vi.fn().mockResolvedValue(undefined),
    retryLater: vi.fn().mockResolvedValue(undefined),
  };
  const editor = { bulkLookup: vi.fn<(bookId: number, userId: number | null) => Promise<BulkLookupOutcome>>().mockResolvedValue(APPLIED) };
  const worker = new ChapterLookupWorker(repo as never, editor as never, { nodeEnv: options.nodeEnv ?? 'test' } as never);
  return { worker, repo, editor };
}

/** Runs a tick to the end, skipping the pauses between lookups. */
async function tick(worker: ChapterLookupWorker): Promise<void> {
  const done = worker.tick();
  await vi.runAllTimersAsync();
  await done;
}

describe('ChapterLookupWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts lookups a restart interrupted back in the queue, and leaves ticking to the test in a test run', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { worker, repo } = setup();

    await worker.onModuleInit();

    expect(repo.requeueProcessing).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it('ticks on its own outside tests, and stops when the module is destroyed', async () => {
    const { worker, repo } = setup({ nodeEnv: 'production' });

    await worker.onModuleInit();
    expect(repo.requeueProcessing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(repo.claimNext).toHaveBeenCalledTimes(1);

    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repo.claimNext).toHaveBeenCalledTimes(1);
  });

  it('records each outcome in queue order on behalf of whoever queued the book', async () => {
    const review: BulkLookupOutcome = { status: 'review', reason: 'runtime_mismatch', result: APPLIED.result };
    const { worker, repo, editor } = setup({
      jobs: [
        { bookId: 41, userId: 7, attemptCount: 1 },
        { bookId: 42, userId: null, attemptCount: 2 },
      ],
    });
    editor.bulkLookup.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce(review);

    await tick(worker);

    expect(editor.bulkLookup.mock.calls).toEqual([
      [41, 7],
      [42, null],
    ]);
    expect(repo.finish.mock.calls).toEqual([
      [41, APPLIED, 'claim'],
      [42, review, 'claim'],
    ]);
    expect(repo.claimNext).toHaveBeenCalledTimes(3);
    expect(repo.retryLater).not.toHaveBeenCalled();
  });

  it('waits between lookups so Audible sees a steady trickle', async () => {
    const { worker, editor } = setup({
      jobs: [
        { bookId: 41, userId: 7, attemptCount: 1 },
        { bookId: 42, userId: 7, attemptCount: 1 },
      ],
    });

    const done = worker.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.bulkLookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(editor.bulkLookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.bulkLookup).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await done;
  });

  it('puts a failed lookup back in the queue until its third attempt, then marks it failed', async () => {
    const { worker, repo, editor } = setup({
      jobs: [
        { bookId: 41, userId: 7, attemptCount: 1 },
        { bookId: 41, userId: 7, attemptCount: 2 },
        { bookId: 41, userId: 7, attemptCount: 3 },
      ],
    });
    editor.bulkLookup.mockRejectedValue(new Error('The chapter sources could not be reached'));

    await tick(worker);

    // A minute before the second try and five before the third, so a brief outage does not use them all up.
    expect(repo.retryLater.mock.calls).toEqual([
      [41, 'The chapter sources could not be reached', 60_000, 'claim'],
      [41, 'The chapter sources could not be reached', 300_000, 'claim'],
    ]);
    expect(repo.finish).toHaveBeenCalledTimes(1);
    expect(repo.finish).toHaveBeenCalledWith(
      41,
      {
        status: 'failed',
        reason: null,
        result: null,
        lastError: 'The chapter sources could not be reached',
      },
      'claim',
    );
  });

  it('keeps the stored error short and on one line', async () => {
    const { worker, repo, editor } = setup({ jobs: [{ bookId: 41, userId: 7, attemptCount: 1 }] });
    editor.bulkLookup.mockRejectedValue(new Error(`first line\nsecond line ${'x'.repeat(1_000)}`));

    await tick(worker);

    const [, lastError] = repo.retryLater.mock.calls[0]! as [number, string];
    expect(lastError).not.toContain('\n');
    expect(lastError.length).toBeLessThanOrEqual(500);
    expect(lastError.startsWith('first line')).toBe(true);
  });

  it('takes at most 10 books in one tick', async () => {
    const jobs = Array.from({ length: 12 }, (_, index) => ({ bookId: 100 + index, userId: 7, attemptCount: 1 }));
    const { worker, editor } = setup({ jobs });

    await tick(worker);
    expect(editor.bulkLookup).toHaveBeenCalledTimes(10);

    await tick(worker);
    expect(editor.bulkLookup).toHaveBeenCalledTimes(12);
  });

  it('runs one tick at a time', async () => {
    const { worker, repo } = setup({ jobs: [{ bookId: 41, userId: 7, attemptCount: 1 }] });

    const first = worker.tick();
    const second = worker.tick();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(repo.claimNext).toHaveBeenCalledTimes(2);
  });

  it('survives a queue that cannot be read and runs again next tick', async () => {
    const { worker, repo, editor } = setup();
    repo.claimNext.mockRejectedValueOnce(new Error('connection terminated')).mockResolvedValueOnce({ bookId: 41, userId: 7, attemptCount: 1 });

    await expect(tick(worker)).resolves.toBeUndefined();
    expect(editor.bulkLookup).not.toHaveBeenCalled();

    await tick(worker);
    expect(editor.bulkLookup).toHaveBeenCalledWith(41, 7);
  });

  it('claims nothing once the module is being destroyed', async () => {
    const { worker, repo } = setup({ jobs: [{ bookId: 41, userId: 7, attemptCount: 1 }] });

    worker.onModuleDestroy();
    await tick(worker);

    expect(repo.claimNext).not.toHaveBeenCalled();
  });
});
