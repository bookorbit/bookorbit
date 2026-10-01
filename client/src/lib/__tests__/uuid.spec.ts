import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from '../uuid'

const NATIVE_UUID = '12345678-1234-4567-89ab-123456789abc'

describe('createUuid', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the native UUID generator when it is available', () => {
    const randomUUID = vi.fn<() => string>(() => NATIVE_UUID)
    const getRandomValues = vi.fn<() => void>()
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })

    expect(createUuid()).toBe(NATIVE_UUID)
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('creates an RFC 4122 version 4 UUID with getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn<(bytes: Uint8Array) => Uint8Array>((bytes) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index))
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(createUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('keeps the UUID contract when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(createUuid()).toBe('00000000-0000-4000-8000-000000000000')
  })
})
