import { RequestImportQueue } from './request-import-queue';

/** Long enough for a settled handler to run the queue's own continuations, and no longer. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A handler that only finishes when the test says so, so concurrency is observable. */
function blockingHandler() {
  const started: number[] = [];
  const finishers = new Map<number, () => void>();
  const handler = (downloadId: number) =>
    new Promise<void>((resolve) => {
      started.push(downloadId);
      finishers.set(downloadId, resolve);
    });
  return { started, handler, finish: (downloadId: number) => finishers.get(downloadId)?.() };
}

describe('RequestImportQueue', () => {
  it('runs no more imports at once than it is allowed', async () => {
    const { started, handler, finish } = blockingHandler();
    const queue = new RequestImportQueue(1, handler, () => {});

    queue.enqueue(11);
    queue.enqueue(12);
    expect(started).toEqual([11]);

    finish(11);
    await flush();
    expect(started).toEqual([11, 12]);

    finish(12);
    await queue.waitForIdle();
  });

  /**
   * The completion path and the resume sweep both offer the same download, and the row stays
   * `completed` for the whole extraction, so the sweep keeps offering it. Two runs would place the
   * same release's files twice.
   */
  it('refuses a download it is already importing', () => {
    const { started, handler } = blockingHandler();
    const queue = new RequestImportQueue(1, handler, () => {});

    expect(queue.enqueue(11)).toBe(true);
    expect(queue.enqueue(11)).toBe(false);
    expect(started).toEqual([11]);
  });

  it('refuses a download already waiting its turn', () => {
    const { handler } = blockingHandler();
    const queue = new RequestImportQueue(1, handler, () => {});

    queue.enqueue(11);
    expect(queue.enqueue(12)).toBe(true);
    expect(queue.enqueue(12)).toBe(false);
  });

  it('takes the same download again once its import is over', async () => {
    const { started, handler, finish } = blockingHandler();
    const queue = new RequestImportQueue(1, handler, () => {});

    queue.enqueue(11);
    finish(11);
    await queue.waitForIdle();

    expect(queue.enqueue(11)).toBe(true);
    expect(started).toEqual([11, 11]);
    finish(11);
    await queue.waitForIdle();
  });

  it('keeps going after one import throws', async () => {
    const failures: Array<[number, unknown]> = [];
    const queue = new RequestImportQueue(
      1,
      (downloadId) => (downloadId === 11 ? Promise.reject(new Error('extraction failed')) : Promise.resolve()),
      (downloadId, error) => failures.push([downloadId, error]),
    );

    queue.enqueue(11);
    queue.enqueue(12);
    await queue.waitForIdle();

    expect(failures).toEqual([[11, expect.objectContaining({ message: 'extraction failed' })]]);
  });

  /** Anything dropped is still `completed` with no dock row, which is what the resume sweep reads. */
  it('drops what has not started when it stops', async () => {
    const { started, handler, finish } = blockingHandler();
    const queue = new RequestImportQueue(1, handler, () => {});

    queue.enqueue(11);
    queue.enqueue(12);
    queue.stop();
    finish(11);
    await flush();

    expect(started).toEqual([11]);
    expect(queue.enqueue(13)).toBe(false);
  });
});
