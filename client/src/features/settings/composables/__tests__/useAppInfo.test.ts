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
    const { version, updateAvailable, latestVersion, features, storyGuides, loaded, isLoading, error } = useAppInfo()
    version.value = ''
    updateAvailable.value = null
    latestVersion.value = null
    features.value = []
    storyGuides.value = null
    loaded.value = false
    isLoading.value = false
    error.value = null
  })

  it('starts in idle state before loadAppInfo is called', () => {
    const { version, updateAvailable, latestVersion, isLoading, error } = useAppInfo()
    expect(version.value).toBe('')
    expect(updateAvailable.value).toBeNull()
    expect(latestVersion.value).toBeNull()
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

  it('keeps the features the server advertises and whether story guides are built or served', async () => {
    mockApi.mockResolvedValue(
      makeOkResponse({
        version: 'v1.0.0',
        updateAvailable: false,
        latestVersion: 'v1.0.0',
        features: ['story-edits', 'story-guides'],
        storyGuides: { building: true, served: false },
      }),
    )

    const { features, storyGuides, supportsFeature, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(features.value).toEqual(['story-edits', 'story-guides'])
    expect(supportsFeature('story-guides')).toBe(true)
    expect(supportsFeature('story-guide-fixes')).toBe(false)
    expect(storyGuides.value).toEqual({ building: true, served: false })
  })

  it('reads an older server without features or story guides as offering neither', async () => {
    mockApi.mockResolvedValue(makeOkResponse({ version: 'v0.9.0', updateAvailable: false, latestVersion: 'v0.9.0' }))

    const { features, storyGuides, supportsFeature, loadAppInfo } = useAppInfo()
    await loadAppInfo()

    expect(features.value).toEqual([])
    expect(supportsFeature('story-guides')).toBe(false)
    expect(storyGuides.value).toBeNull()
  })

  it('loads once for callers that only need an answer, and again when asked to', async () => {
    mockApi.mockResolvedValue(makeOkResponse({ version: 'v1.0.0', updateAvailable: false, latestVersion: 'v1.0.0', features: ['story-guides'] }))

    const { ensureAppInfo, loadAppInfo } = useAppInfo()
    await Promise.all([ensureAppInfo(), ensureAppInfo()])
    await ensureAppInfo()
    expect(mockApi).toHaveBeenCalledOnce()

    await loadAppInfo()
    expect(mockApi).toHaveBeenCalledTimes(2)
  })

  it('lets a caller that arrives during a load wait for its answer', async () => {
    let resolveFirst!: (value: Response) => void
    mockApi.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const { version, loadAppInfo, ensureAppInfo } = useAppInfo()
    void loadAppInfo()
    const waiting = ensureAppInfo().then(() => version.value)
    resolveFirst(makeOkResponse({ version: 'v1.0.0', updateAvailable: false, latestVersion: 'v1.0.0' }))

    await expect(waiting).resolves.toBe('v1.0.0')
  })

  it('tries again after a failed load', async () => {
    mockApi
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(makeOkResponse({ version: 'v1.0.0', updateAvailable: false, latestVersion: 'v1.0.0' }))

    const { loaded, ensureAppInfo } = useAppInfo()
    await ensureAppInfo()
    expect(loaded.value).toBe(false)
    await ensureAppInfo()
    expect(loaded.value).toBe(true)
    expect(mockApi).toHaveBeenCalledTimes(2)
  })
})
