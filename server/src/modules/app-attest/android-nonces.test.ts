import { acceptNonce, isFreshNonce, type NonceState } from './android-nonces';

const WINDOW = 5 * 60_000;
const nonce = (n: number) => `nonce-${String(n).padStart(16, '0')}`;

describe('Android request nonces', () => {
  it('takes a nonce once', () => {
    const state: NonceState = {};
    expect(isFreshNonce(state, nonce(1))).toBe(true);
    acceptNonce(state, nonce(1), 1_000, WINDOW, 1_000);
    expect(isFreshNonce(state, nonce(1))).toBe(false);
    expect(isFreshNonce(state, nonce(2))).toBe(true);
  });

  it('refuses a malformed nonce', () => {
    expect(isFreshNonce({}, 'short')).toBe(false);
    expect(isFreshNonce({}, 'not/base64url+value=')).toBe(false);
    expect(isFreshNonce({}, 'A'.repeat(65))).toBe(false);
  });

  it('forgets a nonce once its request could no longer pass the clock window', () => {
    const state: NonceState = {};
    acceptNonce(state, nonce(1), 0, WINDOW, 0);
    acceptNonce(state, nonce(2), WINDOW + 1, WINDOW, WINDOW + 1);
    expect(state.nonces?.has(nonce(1))).toBe(false);
    expect(state.nonces?.has(nonce(2))).toBe(true);
  });
});
