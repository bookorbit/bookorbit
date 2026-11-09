import { pipelineWithConcurrency } from './batch.utils';

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

describe('pipelineWithConcurrency', () => {
  it('runs the ordered stage one item at a time, in input order', async () => {
    const events: string[] = [];
    let orderedInFlight = 0;

    await pipelineWithConcurrency(
      [1, 2, 3, 4, 5],
      3,
      async (item) => {
        orderedInFlight++;
        expect(orderedInFlight).toBe(1);
        events.push(`ordered ${item}`);
        await tick();
        orderedInFlight--;
        return item;
      },
      async (staged) => {
        await tick((6 - staged) * 2);
      },
    );

    expect(events).toEqual(['ordered 1', 'ordered 2', 'ordered 3', 'ordered 4', 'ordered 5']);
  });

  it('keeps at most `limit` parallel stages running and overlaps them with later ordered stages', async () => {
    let parallelInFlight = 0;
    let peak = 0;
    let orderedWhileParallelRan = false;

    await pipelineWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      (item) => {
        if (parallelInFlight > 0) orderedWhileParallelRan = true;
        return Promise.resolve(item);
      },
      async () => {
        parallelInFlight++;
        peak = Math.max(peak, parallelInFlight);
        await tick(3);
        parallelInFlight--;
      },
    );

    expect(peak).toBe(3);
    expect(orderedWhileParallelRan).toBe(true);
  });

  it('hands each parallel stage what its own ordered stage returned', async () => {
    const seen: Array<[string, number, number]> = [];

    await pipelineWithConcurrency(
      [10, 20, 30],
      2,
      (item) => Promise.resolve(`staged-${item}`),
      (staged, item, index) => {
        seen.push([staged, item, index]);
        return Promise.resolve();
      },
    );

    expect(seen.sort((a, b) => a[2] - b[2])).toEqual([
      ['staged-10', 10, 0],
      ['staged-20', 20, 1],
      ['staged-30', 30, 2],
    ]);
  });

  it('starts nothing after a parallel stage fails, waits for the running ones, then rejects with that error', async () => {
    const ordered: number[] = [];
    const finished: number[] = [];

    await expect(
      pipelineWithConcurrency(
        [0, 1, 2, 3, 4, 5],
        2,
        (item) => {
          ordered.push(item);
          return Promise.resolve(item);
        },
        async (item) => {
          if (item === 1) throw new Error('read failed');
          await tick(5);
          finished.push(item);
        },
      ),
    ).rejects.toThrow('read failed');

    expect(ordered).toEqual([0, 1]);
    expect(finished).toEqual([0]);
  });

  it('waits for the running parallel stages when an ordered stage fails, and gives the failed item none', async () => {
    const finished: number[] = [];

    await expect(
      pipelineWithConcurrency(
        [0, 1, 2],
        3,
        (item) => (item === 1 ? Promise.reject(new Error('register failed')) : Promise.resolve(item)),
        async (item) => {
          await tick(5);
          finished.push(item);
        },
      ),
    ).rejects.toThrow('register failed');

    expect(finished).toEqual([0]);
  });

  it('treats a limit below one as one', async () => {
    let inFlight = 0;
    let peak = 0;

    await pipelineWithConcurrency(
      [1, 2, 3],
      0,
      (item) => Promise.resolve(item),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
      },
    );

    expect(peak).toBe(1);
  });

  it('resolves at once for no items', async () => {
    const ordered = vi.fn();

    await expect(pipelineWithConcurrency([], 4, ordered, vi.fn())).resolves.toBeUndefined();

    expect(ordered).not.toHaveBeenCalled();
  });
});
