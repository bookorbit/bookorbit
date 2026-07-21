import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { ScrollerType } from '@bookorbit/types'

const bookEventsMock = vi.hoisted(() => ({
  progressChangedCallback: null as (() => void) | null,
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

vi.mock('@/features/book/composables/useBookEvents', () => ({
  useBookEvents: () => ({
    onBookProgressChanged: (callback: () => void) => {
      bookEventsMock.progressChangedCallback = callback
      return () => undefined
    },
  }),
}))

import { api } from '@/lib/api'
import { useDashboardScroller } from '../useDashboardScroller'

const mockApi = vi.mocked(api)

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

function mountComposable(type: ScrollerType, limit = 20, smartScopeId?: number) {
  let result!: ReturnType<typeof useDashboardScroller>
  mount(
    defineComponent({
      setup() {
        result = useDashboardScroller(type, limit, smartScopeId)
        return () => null
      },
    }),
  )
  return result
}

describe('useDashboardScroller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bookEventsMock.progressChangedCallback = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads books for up-next-in-series on mount', async () => {
    mockApi.mockResolvedValue(mockResponse([{ id: 7 }, { id: 2 }]))
    const state = mountComposable('up-next-in-series', 12)

    expect(state.loading.value).toBe(true)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/dashboard/scrollers/up-next-in-series?limit=12')
    expect(state.books.value).toEqual([{ id: 7 }, { id: 2 }])
    expect(state.error.value).toBe(false)
    expect(state.loading.value).toBe(false)
  })

  it('includes smartScopeId only for smart-scope requests', async () => {
    mockApi.mockResolvedValue(mockResponse([]))
    mountComposable('smart-scope', 30, 99)

    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/dashboard/scrollers/smart-scope?limit=30&smartScopeId=99')
  })

  it.each([
    ['continue-listening', '/api/v1/dashboard/scrollers/continue-listening?limit=8'],
    ['want-to-read', '/api/v1/dashboard/scrollers/want-to-read?limit=9'],
  ] as const)('loads books for %s on mount', async (type, expectedPath) => {
    mockApi.mockResolvedValue(mockResponse([{ id: 1 }]))

    mountComposable(type, type === 'continue-listening' ? 8 : 9)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith(expectedPath)
  })

  it('sets error=true when API response is not ok', async () => {
    mockApi.mockResolvedValue(mockResponse([], false))
    const state = mountComposable('continue-reading', 5)

    await flushPromises()

    expect(state.books.value).toEqual([])
    expect(state.error.value).toBe(true)
    expect(state.loading.value).toBe(false)
  })

  it('refresh retries after an error and updates books', async () => {
    mockApi.mockResolvedValueOnce(mockResponse([], false)).mockResolvedValueOnce(mockResponse([{ id: 42 }], true))
    const state = mountComposable('continue-reading', 5)

    await flushPromises()
    expect(state.error.value).toBe(true)

    await state.refresh()
    await flushPromises()

    expect(state.error.value).toBe(false)
    expect(state.books.value).toEqual([{ id: 42 }])
  })

  it('debounces progress events and refreshes dashboard membership', async () => {
    vi.useFakeTimers()
    mockApi.mockResolvedValue(mockResponse([{ id: 42 }]))
    mountComposable('continue-reading', 5)
    await flushPromises()
    mockApi.mockClear()

    bookEventsMock.progressChangedCallback?.()
    bookEventsMock.progressChangedCallback?.()
    await vi.advanceTimersByTimeAsync(249)
    expect(mockApi).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(mockApi).toHaveBeenCalledExactlyOnceWith('/api/v1/dashboard/scrollers/continue-reading?limit=5')
  })
})
