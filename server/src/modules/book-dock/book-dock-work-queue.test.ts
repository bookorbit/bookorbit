import { BookDockWorkQueue } from './book-dock-work-queue';

describe('BookDockWorkQueue', () => {
  it('runs queued work within the configured concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondStart = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    const queue = new BookDockWorkQueue(
      1,
      async (fileId) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (fileId === 1) {
            firstStarted();
            await firstDone;
          } else {
            secondStarted();
          }
        } finally {
          active--;
        }
      },
      vi.fn(),
    );

    queue.enqueue(1);
    queue.enqueue(2);

    await firstStart;
    expect(maxActive).toBe(1);

    releaseFirst();
    await secondStart;
    await queue.waitForIdle();

    expect(maxActive).toBe(1);
  });

  it('coalesces duplicate queued or running file ids', async () => {
    const handled: number[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const queue = new BookDockWorkQueue(
      1,
      async (fileId) => {
        handled.push(fileId);
        firstStarted();
        await firstDone;
      },
      vi.fn(),
    );

    queue.enqueue(7);
    queue.enqueue(7);
    await firstStart;
    queue.enqueue(7);

    releaseFirst();
    await queue.waitForIdle();

    expect(handled).toEqual([7]);
  });

  it('reports job errors and keeps draining the queue', async () => {
    const error = new Error('failed');
    const handled: number[] = [];
    const onError = vi.fn();
    const queue = new BookDockWorkQueue(
      1,
      (fileId) => {
        handled.push(fileId);
        return fileId === 1 ? Promise.reject(error) : Promise.resolve();
      },
      onError,
    );

    queue.enqueue(1);
    queue.enqueue(2);
    await queue.waitForIdle();

    expect(handled).toEqual([1, 2]);
    expect(onError).toHaveBeenCalledWith(1, error);
  });

  it('can batch delayed work and run highest-priority jobs first', async () => {
    vi.useFakeTimers();
    try {
      const handled: number[] = [];
      const queue = new BookDockWorkQueue(
        1,
        (fileId) => {
          handled.push(fileId);
          return Promise.resolve();
        },
        vi.fn(),
        { pendingOrder: 'priority-desc', drainDelayMs: 100 },
      );

      queue.enqueue(1, { primary: 10, secondary: 1 });
      await vi.advanceTimersByTimeAsync(90);
      queue.enqueue(2, { primary: 30, secondary: 2 });
      queue.enqueue(3, { primary: 20, secondary: 3 });

      expect(handled).toEqual([]);

      await vi.advanceTimersByTimeAsync(99);
      expect(handled).toEqual([]);

      await vi.advanceTimersByTimeAsync(100);
      await queue.waitForIdle();

      expect(handled).toEqual([2, 3, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits the configured inter-job delay before starting the next queued job', async () => {
    vi.useFakeTimers();
    try {
      let releaseFirst!: () => void;
      let firstStarted!: () => void;
      let secondStarted!: () => void;
      const firstDone = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstStart = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const secondStart = new Promise<void>((resolve) => {
        secondStarted = resolve;
      });

      const queue = new BookDockWorkQueue(
        1,
        async (fileId) => {
          if (fileId === 1) {
            firstStarted();
            await firstDone;
          } else {
            secondStarted();
          }
        },
        vi.fn(),
        { interJobDelayMs: { minMs: 100, maxMs: 100 } },
      );

      queue.enqueue(1);
      queue.enqueue(2);
      await firstStart;

      releaseFirst();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(99);

      let secondHasStarted = false;
      void secondStart.then(() => {
        secondHasStarted = true;
      });
      await Promise.resolve();
      expect(secondHasStarted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await secondStart;
      await queue.waitForIdle();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves waitForIdle immediately when the queue is already empty', async () => {
    const queue = new BookDockWorkQueue(1, vi.fn().mockResolvedValue(undefined), vi.fn());
    await expect(queue.waitForIdle()).resolves.toBeUndefined();
  });

  it('ignores enqueue calls with invalid file ids', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = new BookDockWorkQueue(1, handler, vi.fn());

    queue.enqueue(0);
    queue.enqueue(-1);
    queue.enqueue(1.5);
    await queue.waitForIdle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('stop clears pending items and prevents new work from starting', async () => {
    vi.useFakeTimers();
    try {
      const handler = vi.fn().mockResolvedValue(undefined);
      const queue = new BookDockWorkQueue(1, handler, vi.fn(), { drainDelayMs: 500 });

      queue.enqueue(1);
      queue.enqueue(2);
      queue.stop();
      await queue.waitForIdle();

      expect(handler).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop resolves pre-registered idle waiters when no jobs are running', async () => {
    vi.useFakeTimers();
    try {
      const queue = new BookDockWorkQueue(1, vi.fn().mockResolvedValue(undefined), vi.fn(), { drainDelayMs: 500 });
      queue.enqueue(1);

      const idle = queue.waitForIdle();
      queue.stop();

      await expect(idle).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores enqueue calls after stop', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = new BookDockWorkQueue(1, handler, vi.fn());
    queue.stop();

    queue.enqueue(1);
    await queue.waitForIdle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('processes queued items in lifo order', async () => {
    const handled: number[] = [];
    const queue = new BookDockWorkQueue(
      1,
      (fileId) => {
        handled.push(fileId);
        return Promise.resolve();
      },
      vi.fn(),
      { pendingOrder: 'lifo' },
    );

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await queue.waitForIdle();

    expect(handled[0]).toBe(1);
    expect(handled.slice(1)).toEqual([3, 2]);
  });
});
