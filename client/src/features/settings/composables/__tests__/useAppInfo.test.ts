import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { useAppInfo } from '../useAppInfo'

const mockApi = api as ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

function makeOkResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(data),
  } as unknown as Response
}

function makeErrorResponse(status: number): Response {
  return { ok: false, status, json: vi.fn<() => Promise<unknown>>() } as unknown as Response
}

describe('useAppInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const { version, updateAvailable, latestVersion, bookDockPath, isLoading, error } = useAppInfo()
    version.value = ''
    updateAvailable.value = null
    latestVersion.value = null
    bookDockPath.value = ''
    isLoading.value = false
    error.value = null
  })

  it('starts in idle state before loadAppInfo is called', () => {
    const { version, updateAvailable, latestVersion, bookDockPath, isLoading, error } = useAppInfo()
    expect(version.value).toBe('')
    expect(updateAvailable.value).toBeNull()
    expect(latestVersion.value).toBeNull()
    expect(bookDockPath.value).toBe('')
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('resolves with data from API response', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'v1.2.3',
        updateAvailable: false,
        latestVersion: 'v1.2.3',
      }),
    )

    const { version, updateAvailable, latestVersion, isLoading, loadAppInfo } = useAppInfo()
    const promise = loadAppInfo()
    expect(isLoading.value).toBe(true)
    await promise
    await flushPromises()

    expect(version.value).toBe('v1.2.3')
    expect(updateAvailable.value).toBe(false)
    expect(latestVersion.value).toBe('v1.2.3')
    expect(isLoading.value).toBe(false)
  })

  it('sets updateAvailable: true when a newer version is available', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'v1.2.3',
        updateAvailable: true,
        latestVersion: 'v1.3.0',
      }),
    )

    const { updateAvailable, latestVersion, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(updateAvailable.value).toBe(true)
    expect(latestVersion.value).toBe('v1.3.0')
  })

  it('sets updateAvailable: null for local builds', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'Local build',
        updateAvailable: null,
        latestVersion: null,
      }),
    )

    const { updateAvailable, version, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(version.value).toBe('Local build')
    expect(updateAvailable.value).toBeNull()
  })

  it('handles API error gracefully - sets error ref, does not throw', async () => {
    mockApi.mockRejectedValue(new Error('network failure'))

    const { error, version, loadAppInfo } = useAppInfo()
    await expect(loadAppInfo()).resolves.not.toThrow()

    expect(error.value).toBe('network failure')
    expect(version.value).toBe('')
  })

  it('handles non-ok HTTP response gracefully', async () => {
    mockApi.mockResolvedValue(makeErrorResponse(500))

    const { error, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(error.value).toMatch(/HTTP 500/)
  })

  it('sets isLoading to false after error', async () => {
    mockApi.mockRejectedValue(new Error('fail'))

    const { isLoading, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(isLoading.value).toBe(false)
  })

  it('does not start a concurrent fetch while one is in progress', async () => {
    let resolveFirst!: (value: Response) => void
    mockApi.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const { loadAppInfo } = useAppInfo()
    const first = loadAppInfo()
    const second = loadAppInfo()

    resolveFirst(
      makeOkResponse({
        version: 'v1.0.0',
        updateAvailable: false,
        latestVersion: 'v1.0.0',
      }),
    )
    await Promise.all([first, second])

    expect(mockApi).toHaveBeenCalledOnce()
  })

  it('populates bookDockPath from API response', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'v1.2.3',
        updateAvailable: false,
        latestVersion: 'v1.2.3',
        bookDockPath: '/data/book-dock',
      }),
    )

    const { bookDockPath, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(bookDockPath.value).toBe('/data/book-dock')
  })

  it('defaults bookDockPath to empty string when field is absent from response', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'v1.2.3',
        updateAvailable: false,
        latestVersion: 'v1.2.3',
      }),
    )

    const { bookDockPath, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(bookDockPath.value).toBe('')
  })

  it('does not change bookDockPath on API error', async () => {
    mockApi.mockRejectedValue(new Error('fail'))

    const { bookDockPath, loadAppInfo } = useAppInfo()
    bookDockPath.value = '/data/book-dock'
    await loadAppInfo()

    expect(bookDockPath.value).toBe('/data/book-dock')
  })
})
