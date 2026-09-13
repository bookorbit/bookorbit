import { withDeadline } from './with-deadline.utils';

describe('withDeadline', () => {
  it('hands back what the work resolved with when it beats the deadline', async () => {
    await expect(withDeadline(Promise.resolve('done'), AbortSignal.timeout(1_000))).resolves.toBe('done');
  });

  it("hands back the work's own failure rather than dressing it as a timeout", async () => {
    await expect(withDeadline(Promise.reject(new Error('the tracker answered 500')), AbortSignal.timeout(1_000))).rejects.toThrow(
      'the tracker answered 500',
    );
  });

  /** The case the whole helper exists for: work that watches no signal and never settles. */
  it('ends the wait on work that never settles', async () => {
    await expect(withDeadline(new Promise(() => {}), AbortSignal.timeout(10))).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it("reports the overrun in the caller's own terms when it supplies them", async () => {
    await expect(withDeadline(new Promise(() => {}), AbortSignal.timeout(10), () => new Error('jackett did not answer in time'))).rejects.toThrow(
      'jackett did not answer in time',
    );
  });

  /** A deadline that has already passed must not wait for an abort event that will never fire. */
  it('refuses immediately against a signal that is already aborted', async () => {
    await expect(withDeadline(new Promise(() => {}), AbortSignal.abort(new Error('too late')))).rejects.toThrow('too late');
  });

  /**
   * One deadline can cover several calls, so a listener left behind per call is a leak that grows
   * with the work rather than with the number of deadlines.
   */
  it('stops listening once the work has settled', async () => {
    const controller = new AbortController();

    await withDeadline(Promise.resolve('done'), controller.signal);
    // Aborting after the fact must reach nothing: an unremoved listener would reject a settled
    // promise, which is silent, or throw where nothing is waiting.
    controller.abort(new Error('after the fact'));

    await expect(Promise.resolve('still fine')).resolves.toBe('still fine');
  });
});
