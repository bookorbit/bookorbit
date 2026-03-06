import { FileLockService } from './file-lock.service';

describe('FileLockService', () => {
  it('serializes concurrent access for the same path', async () => {
    const lock = new FileLockService();
    const sequence: string[] = [];

    const first = lock.withLock('/tmp/a', async () => {
      sequence.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      sequence.push('first:end');
      return 1;
    });

    const second = lock.withLock('/tmp/a', async () => {
      sequence.push('second:start');
      sequence.push('second:end');
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(sequence).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('does not serialize different paths', async () => {
    const lock = new FileLockService();
    const starts: string[] = [];

    await Promise.all([
      lock.withLock('/tmp/a', async () => {
        starts.push('a');
      }),
      lock.withLock('/tmp/b', async () => {
        starts.push('b');
      }),
    ]);

    expect(starts).toHaveLength(2);
    expect(new Set(starts)).toEqual(new Set(['a', 'b']));
  });

  it('releases lock after failure so next write can continue', async () => {
    const lock = new FileLockService();

    await expect(
      lock.withLock('/tmp/fail', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(
      lock.withLock('/tmp/fail', async () => {
        return 'ok';
      }),
    ).resolves.toBe('ok');
  });
});
