import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(msg: string) => void>(),
    error: vi.fn<(msg: string) => void>(),
  },
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: { value: [] },
    fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { i18n } from '@/i18n'
import { useFileNamingPattern, previewPath, previewDownloadName } from '../useFileNamingPattern'

const mockApi = vi.mocked(api)
const mockToastSuccess = vi.mocked(toast.success)
const mockToastError = vi.mocked(toast.error)

// The composable calls useI18n(), so it has to run inside a component setup.
function mountComposable(): ReturnType<typeof useFileNamingPattern> {
  let result!: ReturnType<typeof useFileNamingPattern>
  mount(
    {
      setup() {
        result = useFileNamingPattern()
        return () => null
      },
    },
    { global: { plugins: [i18n] } },
  )
  return result
}

function makeOkResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(data),
  } as unknown as Response
}

function makeErrorResponse(): Response {
  return { ok: false, status: 500, json: vi.fn<() => Promise<unknown>>() } as unknown as Response
}

beforeEach(async () => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en'
})

describe('useFileNamingPattern - cross-platform sanitization', () => {
  describe('fetchCrossPlatformSanitization', () => {
    it('sets crossPlatformSanitizationEnabled to true on successful response', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: true }))
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = mountComposable()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(true)
    })

    it('sets crossPlatformSanitizationEnabled to false on successful response with false', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: false }))
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = mountComposable()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(false)
    })

    it('does not change value when response is not ok', async () => {
      mockApi.mockResolvedValueOnce(makeErrorResponse())
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = mountComposable()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(true)
    })

    it('resets loadingCrossPlatformSanitization to false after success', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: true }))
      const { loadingCrossPlatformSanitization, fetchCrossPlatformSanitization } = mountComposable()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(loadingCrossPlatformSanitization.value).toBe(false)
    })

    it('resets loadingCrossPlatformSanitization to false after fetch throws', async () => {
      mockApi.mockRejectedValueOnce(new Error('network error'))
      const { loadingCrossPlatformSanitization, fetchCrossPlatformSanitization } = mountComposable()

      await fetchCrossPlatformSanitization().catch(() => undefined)
      await flushPromises()

      expect(loadingCrossPlatformSanitization.value).toBe(false)
    })
  })

  describe('setCrossPlatformSanitization', () => {
    it('calls api PUT with the correct URL and body', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(true)
      await flushPromises()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/app-settings/cross-platform-path-sanitization',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        }),
      )
    })

    it('calls api PUT with enabled: false when toggled off', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(false)
      await flushPromises()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/app-settings/cross-platform-path-sanitization',
        expect.objectContaining({
          body: JSON.stringify({ enabled: false }),
        }),
      )
    })

    it('applies the new value optimistically and keeps it when the response is ok', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { crossPlatformSanitizationEnabled, setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(false)
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(false)
    })

    it('reverts the value when the response is not ok', async () => {
      mockApi.mockResolvedValueOnce(makeErrorResponse())
      const { crossPlatformSanitizationEnabled, setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(false)
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(true)
    })

    it('shows the enabled toast when turning sanitization on', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(true)
      await flushPromises()

      expect(mockToastSuccess).toHaveBeenCalledWith('Cross-platform path sanitization enabled')
    })

    it('shows the disabled toast when turning sanitization off', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(false)
      await flushPromises()

      expect(mockToastSuccess).toHaveBeenCalledWith('Cross-platform path sanitization disabled')
    })

    it('shows error toast when response is not ok', async () => {
      mockApi.mockResolvedValueOnce(makeErrorResponse())
      const { setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(false)
      await flushPromises()

      expect(mockToastError).toHaveBeenCalledWith('Failed to save cross-platform path sanitization')
    })

    it('resets savingCrossPlatformSanitization to false after success', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { savingCrossPlatformSanitization, setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(true)
      await flushPromises()

      expect(savingCrossPlatformSanitization.value).toBe(false)
    })

    it('resets savingCrossPlatformSanitization to false after api throws', async () => {
      mockApi.mockRejectedValueOnce(new Error('network error'))
      const { savingCrossPlatformSanitization, setCrossPlatformSanitization } = mountComposable()

      await setCrossPlatformSanitization(true).catch(() => undefined)
      await flushPromises()

      expect(savingCrossPlatformSanitization.value).toBe(false)
    })
  })
})

describe('useFileNamingPattern - unsaved change tracking', () => {
  it('reports a pattern as clean right after it is fetched', async () => {
    mockApi.mockResolvedValueOnce(makeOkResponse({ pattern: '{authors}/{title}' }))
    const { globalDirty, fetchGlobalPattern } = mountComposable()

    await fetchGlobalPattern()
    await flushPromises()

    expect(globalDirty.value).toBe(false)
  })

  it('reports a pattern as dirty once it is edited', async () => {
    mockApi.mockResolvedValueOnce(makeOkResponse({ pattern: '{authors}/{title}' }))
    const { globalDirty, fetchGlobalPattern, onGlobalPatternInput } = mountComposable()

    await fetchGlobalPattern()
    await flushPromises()
    onGlobalPatternInput('{title}')

    expect(globalDirty.value).toBe(true)
  })

  it('reports a pattern as clean again after a successful save', async () => {
    mockApi.mockResolvedValueOnce(makeOkResponse({ pattern: '{authors}/{title}' }))
    const { globalDirty, fetchGlobalPattern, onGlobalPatternInput, saveGlobalPattern } = mountComposable()

    await fetchGlobalPattern()
    await flushPromises()
    onGlobalPatternInput('{title}')

    mockApi.mockResolvedValueOnce(makeOkResponse({}))
    await saveGlobalPattern()
    await flushPromises()

    expect(globalDirty.value).toBe(false)
  })

  it('keeps a pattern dirty when the save fails', async () => {
    mockApi.mockResolvedValueOnce(makeOkResponse({ pattern: '{authors}/{title}' }))
    const { globalDirty, fetchGlobalPattern, onGlobalPatternInput, saveGlobalPattern } = mountComposable()

    await fetchGlobalPattern()
    await flushPromises()
    onGlobalPatternInput('{title}')

    mockApi.mockResolvedValueOnce(makeErrorResponse())
    await saveGlobalPattern()
    await flushPromises()

    expect(globalDirty.value).toBe(true)
  })

  it('surfaces a localized error for a pattern with invalid characters', () => {
    const { globalError, onGlobalPatternInput } = mountComposable()

    onGlobalPatternInput('{title}?')

    expect(globalError.value).toBe('Pattern contains invalid characters')
  })
})

describe('previewPath', () => {
  it('returns a path starting with / for a valid pattern', () => {
    const result = previewPath('{authors}/{title}')
    expect(result).toMatch(/^\//)
    expect(result).toContain('.epub')
  })

  it('returns a fallback path when pattern is empty', () => {
    const result = previewPath('')
    expect(result).toBe('/neuromancer.epub')
  })

  it('prepends / when resolved path does not start with /', () => {
    const result = previewPath('{title}')
    expect(result.startsWith('/')).toBe(true)
  })
})

describe('previewDownloadName', () => {
  it('returns a filename string for a valid pattern', () => {
    const result = previewDownloadName('{title}')
    expect(result).toBeTruthy()
    expect(result).toContain('.epub')
  })

  it('uses originalFilename default when pattern is empty', () => {
    const result = previewDownloadName('')
    expect(result).toBeTruthy()
  })
})
