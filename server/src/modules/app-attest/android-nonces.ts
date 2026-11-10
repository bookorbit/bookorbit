export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_NONCES_PER_KEY = 4_096;

export interface NonceState {
  /** Each nonce used, with the time its request was signed at. */
  nonces?: Map<string, number>;
}

/**
 * An Android key has no counter of its own, so each request carries a fresh nonce. One is
 * remembered only for the guard's clock window: a request signed before that is refused as stale
 * whatever its nonce.
 */
export function isFreshNonce(state: NonceState, nonce: string): boolean {
  return NONCE_PATTERN.test(nonce) && !state.nonces?.has(nonce);
}

export function acceptNonce(state: NonceState, nonce: string, sentAt: number, windowMs: number, now = Date.now()): void {
  const nonces = (state.nonces ??= new Map());
  for (const [seen, at] of nonces) {
    if (at < now - windowMs) nonces.delete(seen);
  }
  nonces.set(nonce, sentAt);
  // Only a holder of the key can sign this many inside the window, and it can sign more anyway.
  while (nonces.size > MAX_NONCES_PER_KEY) nonces.delete(nonces.keys().next().value!);
}
