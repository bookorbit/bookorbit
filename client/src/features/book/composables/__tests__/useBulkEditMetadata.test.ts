import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useBulkEditMetadata } from '../useBulkEditMetadata'
import type { BulkEditFields } from '../useBulkEditMetadata'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  toastWarning: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}))

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Test Book',
    authors: ['Author One'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    customMetadata: [],
    tags: [],
    ...overrides,
  }
}

function makeBulkResult(overrides = {}) {
  return {
    updatedBooks: 2,
    fields: {
      publisher: { updated: 2, skippedLocked: 0 },
    },
    ...overrides,
  }
}

describe('useBulkEditMetadata', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.toastSuccess.mockClear()
    mocks.toastError.mockClear()
    mocks.toastWarning.mockClear()
  })

  describe('selectedCount', () => {
    it('returns size of selectedIds when no querySelection', () => {
      const ids = ref(new Set([1, 2, 3]))
      const { selectedCount } = useBulkEditMetadata(ids)
      expect(selectedCount.value).toBe(3)
    })

    it('returns querySelection.total when querySelection is provided', () => {
      const ids = ref(new Set([1, 2]))
      const query = ref({ libraryId: 1, total: 100 })
      const { selectedCount } = useBulkEditMetadata(ids, undefined, query)
      expect(selectedCount.value).toBe(100)
    })

    it('returns size of selectedIds when querySelection is null', () => {
      const ids = ref(new Set([1, 2]))
      const query = ref<{ libraryId?: number; total: number } | null>(null)
      const { selectedCount } = useBulkEditMetadata(ids, undefined, query)
      expect(selectedCount.value).toBe(2)
    })
  })

  describe('submit - selection payload', () => {
    it('sends bookIds payload when no querySelection', async () => {
      const ids = ref(new Set([10, 20]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      const fields: BulkEditFields = { publisher: { value: 'Penguin' } }
      await submit(fields)

      const [, init] = mocks.api.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as { bookIds: number[]; fields: BulkEditFields }
      expect(body.bookIds).toEqual([10, 20])
      expect(body.fields).toEqual(fields)
    })

    it('sends query payload when querySelection is active', async () => {
      const ids = ref(new Set<number>())
      const query = ref({ libraryId: 5, q: 'fantasy', sort: [{ field: 'title' as const, dir: 'asc' as const }], total: 50 })
      const { submit } = useBulkEditMetadata(ids, undefined, query)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      const fields: BulkEditFields = { publisher: { value: 'Penguin' } }
      await submit(fields)

      const [, init] = mocks.api.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as { query: Record<string, unknown>; fields: BulkEditFields }
      expect(body.query).toEqual({ libraryId: 5, q: 'fantasy', sort: [{ field: 'title', dir: 'asc' }] })
      expect(body.fields).toEqual(fields)
      expect((body as Record<string, unknown>).bookIds).toBeUndefined()
    })
  })

  describe('submit - success responses', () => {
    it('shows success toast with count when all books updated', async () => {
      const ids = ref(new Set([1, 2]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 2, fields: { publisher: { updated: 2, skippedLocked: 0 } } }),
      })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated metadata for 2 books')
    })

    it('shows singular book in toast when only 1 book updated', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { publisher: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated metadata for 1 book')
    })

    it('shows warning toast when all books had locked fields', async () => {
      const ids = ref(new Set([1, 2]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => ({ updatedBooks: 0, fields: { publisher: { updated: 0, skippedLocked: 2 } } }),
      })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastWarning).toHaveBeenCalledWith('All selected books had locked fields - no changes applied')
    })

    it('shows partial success toast when some books had locked fields', async () => {
      const ids = ref(new Set([1, 2, 3]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => ({ updatedBooks: 2, fields: { publisher: { updated: 2, skippedLocked: 1 } } }),
      })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated 2 books (some fields skipped due to locks)')
    })

    it('returns the result object on success', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      const result = makeBulkResult()
      mocks.api.mockResolvedValue({ ok: true, json: async () => result })

      const returned = await submit({ publisher: { value: 'Test' } })

      expect(returned).toEqual(result)
    })
  })

  describe('submit - failure responses', () => {
    it('shows error toast on non-ok API response', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: false, json: async () => ({ message: 'Not authorized' }) })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastError).toHaveBeenCalledWith('Not authorized')
    })

    it('shows array message first element on validation errors', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: false, json: async () => ({ message: ['Error 1', 'Error 2'] }) })

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastError).toHaveBeenCalledWith('Error 1')
    })

    it('returns null on non-ok API response', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: false, json: async () => null })

      const result = await submit({ publisher: { value: 'Test' } })

      expect(result).toBeNull()
    })

    it('shows generic error toast when api() throws', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockRejectedValue(new Error('Network error'))

      await submit({ publisher: { value: 'Test' } })

      expect(mocks.toastError).toHaveBeenCalledWith('An unexpected error occurred while saving changes')
    })

    it('returns null when api() throws', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockRejectedValue(new Error('Session expired'))

      const result = await submit({ publisher: { value: 'Test' } })

      expect(result).toBeNull()
    })
  })

  describe('submit - submitting flag', () => {
    it('sets submitting to true during API call', async () => {
      const ids = ref(new Set([1]))
      const { submit, submitting } = useBulkEditMetadata(ids)
      let duringSubmit = false
      mocks.api.mockImplementation(async () => {
        duringSubmit = submitting.value
        return { ok: true, json: async () => makeBulkResult() }
      })

      await submit({ publisher: { value: 'Test' } })

      expect(duringSubmit).toBe(true)
    })

    it('resets submitting to false after success', async () => {
      const ids = ref(new Set([1]))
      const { submit, submitting } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      await submit({ publisher: { value: 'Test' } })

      expect(submitting.value).toBe(false)
    })

    it('resets submitting to false after non-ok response', async () => {
      const ids = ref(new Set([1]))
      const { submit, submitting } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: false, json: async () => null })

      await submit({ publisher: { value: 'Test' } })

      expect(submitting.value).toBe(false)
    })

    it('resets submitting to false when api() throws', async () => {
      const ids = ref(new Set([1]))
      const { submit, submitting } = useBulkEditMetadata(ids)
      mocks.api.mockRejectedValue(new Error('Network error'))

      await submit({ publisher: { value: 'Test' } })

      expect(submitting.value).toBe(false)
    })
  })

  describe('optimistic updates', () => {
    function makeBookList(count = 3) {
      return ref(
        Array.from({ length: count }, (_, i) =>
          makeBook({
            id: i + 1,
            seriesName: 'Old Series',
            publisher: 'Old Publisher',
            language: 'en',
            publishedYear: 2000,
            authors: ['Author One'],
            genres: ['Drama'],
            tags: ['unread'],
            narrators: ['Narrator One'],
          }),
        ),
      )
    }

    it('applies scalar field updates optimistically when no reload needed', async () => {
      const ids = ref(new Set([1, 2, 3]))
      const books = makeBookList(3)
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult({ updatedBooks: 3 }) })

      await submit({
        seriesName: { value: 'New Series' },
        publisher: { value: 'New Publisher' },
        language: { value: 'fr' },
        publishedYear: { value: 2025 },
      })

      for (const book of books.value) {
        expect(book.seriesName).toBe('New Series')
        expect(book.publisher).toBe('New Publisher')
        expect(book.language).toBe('fr')
        expect(book.publishedYear).toBe(2025)
      }
    })

    it('applies null scalar value to clear fields optimistically', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, publisher: 'Old Publisher' })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { publisher: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ publisher: { value: null } })

      expect(books.value[0]!.publisher).toBeNull()
    })

    it('applies replace mode authors update optimistically', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, authors: ['Old Author'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { authors: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ authors: { mode: 'replace', values: ['New Author A', 'New Author B'] } })

      expect(books.value[0]!.authors).toEqual(['New Author A', 'New Author B'])
    })

    it('applies replace mode genres update optimistically', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, genres: ['Drama'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { genres: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ genres: { mode: 'replace', values: ['Fantasy'] } })

      expect(books.value[0]!.genres).toEqual(['Fantasy'])
    })

    it('applies replace mode tags update optimistically', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, tags: ['unread'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { tags: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ tags: { mode: 'replace', values: ['read', 'favorite'] } })

      expect(books.value[0]!.tags).toEqual(['read', 'favorite'])
    })

    it('applies replace mode narrators update optimistically', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, narrators: ['Old Narrator'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { narrators: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ narrators: { mode: 'replace', values: ['New Narrator'] } })

      expect(books.value[0]!.narrators).toEqual(['New Narrator'])
    })

    it('replaces genres with empty array to clear all', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, genres: ['Drama', 'Sci-Fi'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { genres: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ genres: { mode: 'replace', values: [] } })

      expect(books.value[0]!.genres).toEqual([])
    })

    it('clears authors optimistically when replace with empty values (clear mode payload)', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, authors: ['Author One', 'Author Two'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { authors: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ authors: { mode: 'replace', values: [] } })

      expect(books.value[0]!.authors).toEqual([])
    })

    it('clears tags optimistically when replace with empty values (clear mode payload)', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, tags: ['read', 'favorite'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { tags: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ tags: { mode: 'replace', values: [] } })

      expect(books.value[0]!.tags).toEqual([])
    })

    it('clears narrators optimistically when replace with empty values (clear mode payload)', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, narrators: ['Narrator A'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({
        ok: true,
        json: async () => makeBulkResult({ updatedBooks: 1, fields: { narrators: { updated: 1, skippedLocked: 0 } } }),
      })

      await submit({ narrators: { mode: 'replace', values: [] } })

      expect(books.value[0]!.narrators).toEqual([])
    })

    it('only updates books in selectedIds', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, publisher: 'Old' }), makeBook({ id: 2, publisher: 'Old' })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult({ updatedBooks: 1 }) })

      await submit({ publisher: { value: 'New' } })

      expect(books.value[0]!.publisher).toBe('New')
      expect(books.value[1]!.publisher).toBe('Old')
    })

    it('does not apply optimistic update when add mode is used (triggers reload)', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, authors: ['Author One'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      await submit({ authors: { mode: 'add', values: ['Author Two'] } })

      expect(books.value[0]!.authors).toEqual(['Author One'])
    })

    it('does not apply optimistic update when remove mode is used (triggers reload)', async () => {
      const ids = ref(new Set([1]))
      const books = ref([makeBook({ id: 1, tags: ['tag1', 'tag2'] })])
      const { submit } = useBulkEditMetadata(ids, books)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      await submit({ tags: { mode: 'remove', values: ['tag1'] } })

      expect(books.value[0]!.tags).toEqual(['tag1', 'tag2'])
    })

    it('does not apply optimistic update when querySelection is active', async () => {
      const ids = ref(new Set<number>())
      const books = ref([makeBook({ id: 1, publisher: 'Old' })])
      const query = ref({ libraryId: 1, total: 100 })
      const { submit } = useBulkEditMetadata(ids, books, query)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      await submit({ publisher: { value: 'New' } })

      expect(books.value[0]!.publisher).toBe('Old')
    })

    it('does not apply optimistic update when books ref is not provided', async () => {
      const ids = ref(new Set([1]))
      const { submit } = useBulkEditMetadata(ids)
      mocks.api.mockResolvedValue({ ok: true, json: async () => makeBulkResult() })

      await expect(submit({ publisher: { value: 'Test' } })).resolves.not.toThrow()
    })
  })
})
