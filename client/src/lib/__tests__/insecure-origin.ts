import { vi } from 'vitest'

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * `crypto` as a page served over plain HTTP from anything but localhost sees it, which is how most
 * self-hosted installs are first opened: `getRandomValues` is there, `randomUUID` and `subtle` are
 * not. Backed by real randomness so a caller can assert that the IDs it makes stay unique.
 *
 * `restore` puts the native object back without `vi.unstubAllGlobals()`, which would also undo any
 * module-level stub the calling spec depends on.
 */
export function stubInsecureOriginCrypto() {
  const native = globalThis.crypto
  const getRandomValues = vi.fn<Crypto['getRandomValues']>((array) => native.getRandomValues(array))
  vi.stubGlobal('crypto', { getRandomValues })
  return {
    getRandomValues,
    restore: () => vi.stubGlobal('crypto', native),
  }
}
