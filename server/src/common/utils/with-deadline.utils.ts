/**
 * A deadline as an outcome rather than as a request the callee may ignore.
 *
 * An `AbortSignal` handed to somebody else only ends the work that actually watches it. A plugin
 * can check its signal between requests but not during one; an adapter may await a promise of its
 * own that never settles; an HTTP client may lose its own timeout. Racing the signal against the
 * promise ends the *wait* either way, which is what the caller can act on: a slot in a bounded
 * pool comes back, a `Promise.all` resolves, a latch is released.
 *
 * It does not cancel the work. Whatever was running goes on running, unattached; the signal is
 * still passed down so anything watching it can stop properly, and this is only the backstop for
 * everything that does not.
 *
 * `timeoutError` shapes the rejection, because each caller reports an overrun in its own terms.
 * Without one the signal's own reason is used, which is a `TimeoutError` for `AbortSignal.timeout`.
 */
export function withDeadline<T>(work: Promise<T>, signal: AbortSignal, timeoutError?: () => Error): Promise<T> {
  // `signal.reason` is a `TimeoutError` for every deadline here, but an `AbortController` can be
  // aborted with anything at all, and a rejection that is not an `Error` loses its stack.
  const reason = (): Error => {
    if (timeoutError) return timeoutError();
    return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
  };
  if (signal.aborted) return Promise.reject(reason());

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(reason());
    signal.addEventListener('abort', onAbort, { once: true });
    // Removed on settle either way, so a long-lived deadline shared by several calls does not
    // accumulate a listener per call.
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
