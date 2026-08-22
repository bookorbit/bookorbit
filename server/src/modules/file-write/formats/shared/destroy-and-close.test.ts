import { EventEmitter } from 'events';
import type { Writable } from 'stream';

import { destroyAndClose } from './destroy-and-close';

type FakeStream = EventEmitter & { closed: boolean; destroy: () => void };

function makeStream(options?: { errorOnDestroy?: boolean; closeOnDestroy?: boolean }): FakeStream {
  const stream = new EventEmitter() as FakeStream;
  stream.closed = false;
  stream.destroy = vi.fn(() => {
    if (options?.errorOnDestroy) stream.emit('error', new Error('write failed'));
    if (options?.closeOnDestroy !== false) {
      stream.closed = true;
      stream.emit('close');
    }
  });
  return stream;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('destroyAndClose', () => {
  it('destroys the stream and resolves once it closes', async () => {
    const stream = makeStream();

    await expect(destroyAndClose(stream as unknown as Writable)).resolves.toBeUndefined();
    expect(stream.destroy).toHaveBeenCalled();
  });

  it('returns without destroying a stream that has already closed', async () => {
    const stream = makeStream();
    stream.closed = true;

    await destroyAndClose(stream as unknown as Writable);

    expect(stream.destroy).not.toHaveBeenCalled();
  });

  it('does not resolve on error alone, because the handle may still be open', async () => {
    const stream = makeStream({ errorOnDestroy: true, closeOnDestroy: false });
    let settled = false;
    const pending = destroyAndClose(stream as unknown as Writable).then(() => {
      settled = true;
    });

    await flush();
    expect(settled).toBe(false);

    stream.closed = true;
    stream.emit('close');
    await pending;

    expect(settled).toBe(true);
  });
});
