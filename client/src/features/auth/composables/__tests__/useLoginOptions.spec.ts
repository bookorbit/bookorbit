import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLoginOptions } from '../useLoginOptions'

describe('useLoginOptions', () => {
  const originalFetch = globalThis.fetch
  let reload: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn<() => void>()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reloads the page when an edge auth proxy redirects the request, instead of reporting an error', async () => {
    const res = new Response(null)
    Object.defineProperty(res, 'type', { value: 'opaqueredirect' })
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(res))
    globalThis.fetch = fetchMock as never

    const { fetchLoginOptions, loginOptionsError } = useLoginOptions()
    void fetchLoginOptions(true)

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe('manual')
    expect(loginOptionsError.value).toBeNull()
  })

  it('still loads the options normally when there is no proxy in the way', async () => {
    const options = { localAuthEnabled: true, oidcProviders: [] }
    globalThis.fetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(options), { status: 200 }))) as never

    const { fetchLoginOptions } = useLoginOptions()

    await expect(fetchLoginOptions(true)).resolves.toEqual(options)
    expect(reload).not.toHaveBeenCalled()
  })
})
