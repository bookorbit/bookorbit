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

function mockSuccessfulBatch(books: unknown[], failed = false): void {
  mockApi.mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { items: Array<{ id: string }> }
    return mockResponse({ items: body.items.map((item) => ({ id: item.id, books, failed })) })
  })
}

function batchBody(): { items: Array<{ id: string; type: string; limit: number; smartScopeId?: number }> } {
  const init = mockApi.mock.calls.at(-1)?.[1]
  return JSON.parse(String(init?.body))
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
    mockSuccessfulBatch([{ id: 7 }, { id: 2 }])
    const state = mountComposable('up-next-in-series', 12)

    expect(state.loading.value).toBe(true)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/dashboard/scrollers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    })
    expect(batchBody().items).toEqual([{ id: expect.any(String), type: 'up-next-in-series', limit: 12 }])
    expect(state.books.value).toEqual([{ id: 7 }, { id: 2 }])
    expect(state.error.value).toBe(false)
    expect(state.loading.value).toBe(false)
  })

  it('includes smartScopeId only for smart-scope requests', async () => {
    mockSuccessfulBatch([])
    mountComposable('smart-scope', 30, 99)

    await flushPromises()

    expect(batchBody().items).toEqual([{ id: expect.any(String), type: 'smart-scope', limit: 30, smartScopeId: 99 }])
  })

  it.each([
    ['continue-listening', 8],
    ['want-to-read', 9],
  ] as const)('loads books for %s on mount', async (type, limit) => {
    mockSuccessfulBatch([{ id: 1 }])

    mountComposable(type, limit)
    await flushPromises()

    expect(batchBody().items[0]).toMatchObject({ type, limit })
  })

  it('consolidates shelves mounted in the same turn into one request', async () => {
    mockSuccessfulBatch([{ id: 1 }])

    mountComposable('recently-added', 20)
    mountComposable('want-to-read', 10)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledOnce()
    expect(batchBody().items.map(({ type, limit }) => ({ type, limit }))).toEqual([
      { type: 'recently-added', limit: 20 },
      { type: 'want-to-read', limit: 10 },
    ])
  })

  it('sets error=true when API response is not ok', async () => {
    mockApi.mockResolvedValue(mockResponse({}, false))
    const state = mountComposable('continue-reading', 5)

    await flushPromises()

    expect(state.books.value).toEqual([])
    expect(state.error.value).toBe(true)
    expect(state.loading.value).toBe(false)
  })

  it('refresh retries after an error and updates books', async () => {
    mockApi.mockResolvedValueOnce(mockResponse({}, false)).mockImplementationOnce(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { items: Array<{ id: string }> }
      return mockResponse({ items: body.items.map((item) => ({ id: item.id, books: [{ id: 42 }], failed: false })) })
    })
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
    mockSuccessfulBatch([{ id: 42 }])
    mountComposable('continue-reading', 5)
    await flushPromises()
    mockApi.mockClear()

    bookEventsMock.progressChangedCallback?.()
    bookEventsMock.progressChangedCallback?.()
    await vi.advanceTimersByTimeAsync(249)
    expect(mockApi).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(mockApi).toHaveBeenCalledOnce()
    expect(batchBody().items[0]).toMatchObject({ type: 'continue-reading', limit: 5 })
  })
})
