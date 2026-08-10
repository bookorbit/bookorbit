import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>()

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

async function loadComposable() {
  vi.resetModules()
  const { useSetupStatus } = await import('../composables/useSetupStatus')
  return useSetupStatus()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useSetupStatus', () => {
  it('exposes allowRegistration from the status payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ needsSetup: false, allowRegistration: true }))

    const { fetchSetupStatus, needsSetup, allowRegistration } = await loadComposable()
    await fetchSetupStatus()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/setup-status', { credentials: 'include' })
    expect(needsSetup.value).toBe(false)
    expect(allowRegistration.value).toBe(true)
  })

  it('treats a false allowRegistration as closed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ needsSetup: false, allowRegistration: false }))

    const { fetchSetupStatus, allowRegistration } = await loadComposable()
    await fetchSetupStatus()

    expect(allowRegistration.value).toBe(false)
  })

  it('treats an absent allowRegistration field as closed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ needsSetup: true }))

    const { fetchSetupStatus, allowRegistration, needsSetup } = await loadComposable()
    await fetchSetupStatus()

    expect(needsSetup.value).toBe(true)
    expect(allowRegistration.value).toBe(false)
  })

  it('caches the status so repeat navigations do not refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ needsSetup: false, allowRegistration: true }))

    const { fetchSetupStatus } = await loadComposable()
    await fetchSetupStatus()
    await fetchSetupStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when forced', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ needsSetup: false, allowRegistration: false }))
    const { fetchSetupStatus, allowRegistration } = await loadComposable()
    await fetchSetupStatus()
    expect(allowRegistration.value).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse({ needsSetup: false, allowRegistration: true }))
    await fetchSetupStatus(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(allowRegistration.value).toBe(true)
  })

  it('surfaces an error and leaves registration closed when the request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    const { fetchSetupStatus, allowRegistration, setupStatusError } = await loadComposable()
    await expect(fetchSetupStatus()).rejects.toThrow('Failed to load setup status')

    expect(allowRegistration.value).toBe(false)
    expect(setupStatusError.value).toBe('Failed to load setup status')
  })
})
