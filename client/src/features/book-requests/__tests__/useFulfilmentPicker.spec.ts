// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: apiMock }))

import { useFulfilmentPicker } from '../composables/useFulfilmentPicker'

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** The composable debounces, so every search assertion has to let the timer run. */
async function settle(ms = 400) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('useFulfilmentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('builds the payload the fulfil endpoint takes, never a raw id on screen', () => {
    const picker = useFulfilmentPicker()

    expect(picker.toPayload()).toBeNull()

    picker.select({ source: 'book', id: 128 })
    expect(picker.toPayload()).toEqual({ matchedBookId: 128 })

    picker.setSource('dockFile')
    picker.select({ source: 'dockFile', id: 42 })
    expect(picker.toPayload()).toEqual({ bookDockFileId: 42 })
  })

  it('drops the selection when the source changes, because a book id is not a dock file id', () => {
    const picker = useFulfilmentPicker()

    picker.select({ source: 'book', id: 128 })
    picker.setSource('dockFile')

    expect(picker.selected.value).toBeNull()
    expect(picker.toPayload()).toBeNull()
  })

  it('toggles a selected row off when it is picked again', () => {
    const picker = useFulfilmentPicker()

    picker.select({ source: 'book', id: 128 })
    expect(picker.isSelected({ source: 'book', id: 128 })).toBe(true)

    picker.select({ source: 'book', id: 128 })
    expect(picker.selected.value).toBeNull()
  })

  it('searches the library for books and the dock for files', async () => {
    apiMock.mockResolvedValue(ok({ items: [{ id: 1, title: 'Watchers' }], total: 1, page: 0, size: 6 }))
    const picker = useFulfilmentPicker()

    picker.search('watchers')
    await settle()
    expect(apiMock.mock.calls[0]?.[0]).toBe('/api/v1/books/query')
    expect(picker.books.value).toHaveLength(1)

    apiMock.mockResolvedValue(ok({ items: [{ id: 9, fileName: 'watchers.epub' }], total: 1, page: 1, size: 6 }))
    picker.setSource('dockFile')
    await settle()
    expect(apiMock.mock.calls[1]?.[0]).toContain('/api/v1/book-dock/files?')
    expect(picker.dockFiles.value).toHaveLength(1)
  })

  it('clears results for an emptied box without spending a request on it', async () => {
    apiMock.mockResolvedValue(ok({ items: [{ id: 1, title: 'Watchers' }], total: 1, page: 0, size: 6 }))
    const picker = useFulfilmentPicker()

    picker.search('watchers')
    await settle()
    expect(picker.books.value).toHaveLength(1)

    picker.search('   ')
    await settle()
    expect(picker.books.value).toEqual([])
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('keeps only the last search when a fast typist outruns the debounce', async () => {
    apiMock.mockResolvedValue(ok({ items: [], total: 0, page: 0, size: 6 }))
    const picker = useFulfilmentPicker()

    picker.search('w')
    picker.search('wa')
    picker.search('wat')
    await settle()

    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})
