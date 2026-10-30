import { RequestStageQueue } from './request-stage-queue';

/** Long enough for the queue's own continuations to run after a handler settles, and no longer. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A handler that only finishes when the test says so, so slot occupancy is observable. */
function blockingHandler() {
  const finishers = new Map<string, () => void>();
  const handler = (job: { clientKey: string }) =>
    new Promise<void>((resolve) => {
      finishers.set(job.clientKey, resolve);
    });
  return { handler, finish: (clientKey: string) => finishers.get(clientKey)?.() };
}

describe('RequestStageQueue.isPending', () => {
  it('recognises a job that is still waiting for a slot', () => {
    const { handler } = blockingHandler();
    const queue = new RequestStageQueue(1, handler, () => {});

    queue.enqueue({ clientId: 4, clientKey: 'a', downloadId: 11 });
    queue.enqueue({ clientId: 4, clientKey: 'b', downloadId: 12 });

    expect(queue.isPending({ clientId: 4, clientKey: 'b' })).toBe(true);
    // The one holding the only slot is running: reporting it as pending would vouch for a fetch
    // that is no longer waiting its turn.
    expect(queue.isPending({ clientId: 4, clientKey: 'a' })).toBe(false);

    queue.stop();
  });

  it('stops reporting a job once it starts running', async () => {
    const { handler, finish } = blockingHandler();
    const queue = new RequestStageQueue(1, handler, () => {});

    queue.enqueue({ clientId: 4, clientKey: 'a', downloadId: 11 });
    queue.enqueue({ clientId: 4, clientKey: 'b', downloadId: 12 });
    expect(queue.isPending({ clientId: 4, clientKey: 'b' })).toBe(true);

    finish('a');
    await flush();

    expect(queue.isPending({ clientId: 4, clientKey: 'b' })).toBe(false);
    finish('b');
    await queue.waitForIdle();
  });

  it('knows nothing about a job it never accepted', () => {
    const queue = new RequestStageQueue(1, blockingHandler().handler, () => {});

    expect(queue.isPending({ clientId: 4, clientKey: 'absent' })).toBe(false);
  });

  it('forgets what it dropped when it stops', () => {
    const queue = new RequestStageQueue(1, blockingHandler().handler, () => {});

    queue.enqueue({ clientId: 4, clientKey: 'a', downloadId: 11 });
    queue.enqueue({ clientId: 4, clientKey: 'b', downloadId: 12 });
    queue.stop();

    expect(queue.isPending({ clientId: 4, clientKey: 'b' })).toBe(false);
  });
});
