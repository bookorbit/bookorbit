import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { BookCard } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn<(message: string) => void>(),
  },
}))

import { useTableCellEditor } from '../useTableCellEditor'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'ok',
    title: 'Test Book',
    authors: ['Author One'],
    seriesName: 'My Series',
    seriesIndex: 1,
    files: [],
    publishedDate: null,
    publishedYear: 2020,
    language: 'en',
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00Z',
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
    ...overrides,
  }
}

describe('useTableCellEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activateCell sets activeCellKey and clones current value', () => {
    const editor = useTableCellEditor()
    editor.activateCell(1, 'title', 'Hello')
    expect(editor.activeCellKey.value).toBe('1:title')
    expect(editor.editValue.value).toBe('Hello')
  })

  it('activateCell deep-clones array values', () => {
    const editor = useTableCellEditor()
    const original = ['a', 'b']
    editor.activateCell(1, 'authors', original)
    expect(editor.editValue.value).toEqual(original)
    expect(editor.editValue.value).not.toBe(original)
  })

  it('cancelCell clears activeCellKey and editValue', () => {
    const editor = useTableCellEditor()
    editor.activateCell(1, 'title', 'Hello')
    editor.cancelCell()
    expect(editor.activeCellKey.value).toBeNull()
    expect(editor.editValue.value).toBeNull()
  })

  it('cancelCellIfActive clears when source matches active cell', () => {
    const editor = useTableCellEditor()
    editor.activateCell(1, 'title', 'Hello')

    expect(editor.cancelCellIfActive(1, 'title')).toBe(true)
    expect(editor.activeCellKey.value).toBeNull()
    expect(editor.editValue.value).toBeNull()
  })

  it('cancelCellIfActive ignores stale cancel from a different cell', () => {
    const editor = useTableCellEditor()
    editor.activateCell(2, 'title', 'Still editing')

    expect(editor.cancelCellIfActive(1, 'title')).toBe(false)
    expect(editor.activeCellKey.value).toBe('2:title')
    expect(editor.editValue.value).toBe('Still editing')
  })

  it('isActive returns true for the active cell', () => {
    const editor = useTableCellEditor()
    editor.activateCell(5, 'authors', [])
    expect(editor.isActive(5, 'authors')).toBe(true)
    expect(editor.isActive(5, 'title')).toBe(false)
    expect(editor.isActive(6, 'authors')).toBe(false)
  })

  it('saveCell calls PATCH /metadata for metadata fields', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(book.id, 'title', 'New Title', onSuccess)

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/books/${book.id}/metadata`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'New Title' }),
      }),
    )
    expect(onSuccess).toHaveBeenCalledWith({ title: 'New Title' })
  })

  it('saveCell calls PATCH /status for readStatus field', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'reading',
        source: 'manual',
        startedAt: '2026-04-01',
        finishedAt: null,
        updatedAt: '2026-04-02T00:00:00.000Z',
      }),
    } as Response)
    const editor = useTableCellEditor()
    const book = makeBook()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(book.id, 'readStatus', 'reading', onSuccess)

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/books/${book.id}/status`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'reading' }),
      }),
    )
    expect(onSuccess).toHaveBeenCalledWith({
      readStatus: {
        status: 'reading',
        source: 'manual',
        startedAt: '2026-04-01',
        finishedAt: null,
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    })
  })

  it('saveCell falls back to synthetic readStatus payload when status response JSON parsing fails', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('invalid json')
      },
    } as unknown as Response)
    const editor = useTableCellEditor()
    const book = makeBook()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(book.id, 'readStatus', 'reading', onSuccess)

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        readStatus: expect.objectContaining({
          status: 'reading',
          source: 'manual',
          startedAt: null,
          finishedAt: null,
        }),
      }),
    )
  })

  it('saveCell calls onSuccess callback and clears active cell on success', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    editor.activateCell(1, 'title', 'Old')
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(1, 'title', 'New', onSuccess)

    expect(onSuccess).toHaveBeenCalled()
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('saveCell shows error toast and clears cell on API failure', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response)
    const editor = useTableCellEditor()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(1, 'title', 'New', onSuccess)

    expect(onSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('saveCell clears the matching active cell on failure', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response)
    const editor = useTableCellEditor()
    editor.activateCell(1, 'title', 'Old')

    await editor.saveCell(1, 'title', 'New', vi.fn<(patch: Partial<BookCard>) => void>())

    expect(editor.activeCellKey.value).toBeNull()
    expect(editor.editValue.value).toBeNull()
  })

  it('saveCell shows metadata lock message on 409 conflict', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'Metadata fields are locked: publishedYear' }),
    } as Response)
    const editor = useTableCellEditor()

    await editor.saveCell(1, 'publishedYear', null, vi.fn<(patch: Partial<BookCard>) => void>())

    expect(mocks.toastError).toHaveBeenCalledWith('Metadata fields are locked: publishedYear')
  })

  it('saveCell shows error toast and clears cell on network error', async () => {
    ;(mocks.api as Mock).mockRejectedValue(new Error('network fail'))
    const editor = useTableCellEditor()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(1, 'title', 'New', onSuccess)

    expect(onSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('saveCell does not start if isSaving is already true', async () => {
    let resolveFirst!: () => void
    const slowPromise = new Promise<Response>((res) => {
      resolveFirst = () => res({ ok: true } as Response)
    })
    ;(mocks.api as Mock).mockReturnValue(slowPromise)

    const editor = useTableCellEditor()
    const onSuccess1 = vi.fn<(patch: Partial<BookCard>) => void>()
    const onSuccess2 = vi.fn<(patch: Partial<BookCard>) => void>()

    const p1 = editor.saveCell(1, 'title', 'First', onSuccess1)
    expect(editor.isSaving.value).toBe(true)

    await editor.saveCell(1, 'title', 'Second', onSuccess2)

    resolveFirst()
    await p1

    expect(onSuccess2).not.toHaveBeenCalled()
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('activateCell is blocked while isSaving is true', async () => {
    let resolve!: () => void
    const slowPromise = new Promise<Response>((res) => {
      resolve = () => res({ ok: true } as Response)
    })
    ;(mocks.api as Mock).mockReturnValue(slowPromise)

    const editor = useTableCellEditor()
    const p = editor.saveCell(1, 'title', 'New', vi.fn<(patch: Partial<BookCard>) => void>())

    editor.activateCell(2, 'authors', [])
    expect(editor.activeCellKey.value).toBeNull()

    resolve()
    await p
  })

  it('navigateCell moves to the next editable column', () => {
    const editor = useTableCellEditor()
    const cols = ['title', 'authors', 'seriesName'] as import('../useTableColumns').ColumnId[]
    const book = makeBook()
    editor.activateCell(1, 'title', 'val')
    editor.navigateCell('next', cols, book, 'title')
    expect(editor.activeCellKey.value).toBe('1:authors')
    expect(editor.editValue.value).toEqual(book.authors)
  })

  it('navigateCell moves to the previous editable column', () => {
    const editor = useTableCellEditor()
    const cols = ['title', 'authors', 'seriesName'] as import('../useTableColumns').ColumnId[]
    const book = makeBook()
    editor.activateCell(1, 'authors', [])
    editor.navigateCell('prev', cols, book, 'authors')
    expect(editor.activeCellKey.value).toBe('1:title')
    expect(editor.editValue.value).toBe(book.title)
  })

  it('navigateCell does not wrap or error at last column (next)', () => {
    const editor = useTableCellEditor()
    const cols = ['title', 'authors'] as import('../useTableColumns').ColumnId[]
    const book = makeBook()
    editor.navigateCell('next', cols, book, 'authors')
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('navigateCell does not wrap or error at first column (prev)', () => {
    const editor = useTableCellEditor()
    const cols = ['title', 'authors'] as import('../useTableColumns').ColumnId[]
    const book = makeBook()
    editor.navigateCell('prev', cols, book, 'title')
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('navigateCell does nothing if currentColumnId not in list', () => {
    const editor = useTableCellEditor()
    const cols = ['title', 'authors'] as import('../useTableColumns').ColumnId[]
    const book = makeBook()
    editor.navigateCell('next', cols, book, 'rating')
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('navigateRowUp moves to the previous row in the same column', () => {
    const editor = useTableCellEditor()
    const books = [makeBook({ id: 1, title: 'Book 1' }), makeBook({ id: 2, title: 'Book 2' }), makeBook({ id: 3, title: 'Book 3' })]

    editor.navigateRowUp(books, 2, 'title')

    expect(editor.activeCellKey.value).toBe('1:title')
    expect(editor.editValue.value).toBe('Book 1')
  })

  it('navigateRowDown moves to the next row in the same column', () => {
    const editor = useTableCellEditor()
    const books = [makeBook({ id: 1, title: 'Book 1' }), makeBook({ id: 2, title: 'Book 2' }), makeBook({ id: 3, title: 'Book 3' })]

    editor.navigateRowDown(books, 2, 'title')

    expect(editor.activeCellKey.value).toBe('3:title')
    expect(editor.editValue.value).toBe('Book 3')
  })

  it('navigateRow does nothing at list boundaries', () => {
    const editor = useTableCellEditor()
    const books = [makeBook({ id: 1, title: 'First' }), makeBook({ id: 2, title: 'Second' })]

    editor.navigateRowUp(books, 1, 'title')
    expect(editor.activeCellKey.value).toBeNull()

    editor.navigateRowDown(books, 2, 'title')
    expect(editor.activeCellKey.value).toBeNull()
  })

  it('navigateRow sets null edit value when column accessor is unavailable', () => {
    const editor = useTableCellEditor()
    const books = [makeBook({ id: 1, title: 'Book 1' }), makeBook({ id: 2, title: 'Book 2' })]

    editor.navigateRowDown(books, 1, 'unknownColumn' as never)

    expect(editor.activeCellKey.value).toBe('2:unknownColumn')
    expect(editor.editValue.value).toBeNull()
  })

  it('saveCell sends audioMetadata.narrators for narrators column', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()
    const narrators = ['Narrator One', 'Narrator Two']

    await editor.saveCell(book.id, 'narrators', narrators, onSuccess)

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/books/${book.id}/metadata`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ audioMetadata: { narrators } }),
      }),
    )
    expect(onSuccess).toHaveBeenCalledWith({ narrators })
  })

  it('saveCell short-circuits unsupported fields with a toast and no API call', async () => {
    const editor = useTableCellEditor()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(1, 'notAColumn' as never, 'value', onSuccess)

    expect(mocks.api).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Cannot save: unsupported field "notAColumn"')
  })

  it('saveCell does not clear a different active cell on success', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    editor.activateCell(2, 'title', 'Current Active')

    await editor.saveCell(1, 'title', 'Old Cell Save', vi.fn<(patch: Partial<BookCard>) => void>())

    expect(editor.activeCellKey.value).toBe('2:title')
  })

  it('saveCell does not clear a different active cell on failure', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response)
    const editor = useTableCellEditor()
    editor.activateCell(2, 'title', 'Current Active')

    await editor.saveCell(1, 'title', 'Old Cell Save', vi.fn<(patch: Partial<BookCard>) => void>())

    expect(editor.activeCellKey.value).toBe('2:title')
  })
})

describe('useTableCellEditor - custom field saving', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saveCell for custom:N calls PATCH /metadata with customMetadata payload', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({ id: 5 })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'Winner', onSuccess, book)

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/5/metadata',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ customMetadata: [{ fieldId: 42, value: 'Winner' }] }),
      }),
    )
  })

  it('saveCell for custom:N calls onSuccess with patched customMetadata for existing entry', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({
      id: 5,
      customMetadata: [{ fieldId: 42, key: 'award', label: 'Award', type: 'text', displayOrder: 0, value: 'Old Value' }],
    })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'New Value', onSuccess, book)

    expect(onSuccess).toHaveBeenCalledWith({
      customMetadata: [{ fieldId: 42, key: 'award', label: 'Award', type: 'text', displayOrder: 0, value: 'New Value' }],
    })
  })

  it('saveCell for custom:N preserves other customMetadata entries when patching', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({
      id: 5,
      customMetadata: [
        { fieldId: 1, key: 'f1', label: 'F1', type: 'text', displayOrder: 0, value: 'keep' },
        { fieldId: 42, key: 'award', label: 'Award', type: 'text', displayOrder: 1, value: 'old' },
      ],
    })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'new', onSuccess, book)

    const result = onSuccess.mock.calls[0]![0] as Partial<BookCard>
    expect(result.customMetadata).toHaveLength(2)
    expect(result.customMetadata!.find((f) => f.fieldId === 1)?.value).toBe('keep')
    expect(result.customMetadata!.find((f) => f.fieldId === 42)?.value).toBe('new')
  })

  it('saveCell for custom:N with no existing entry in book leaves customMetadata unchanged', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({ id: 5, customMetadata: [] })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'first value', onSuccess, book)

    const result = onSuccess.mock.calls[0]![0] as Partial<BookCard>
    expect(result.customMetadata).toHaveLength(0)
  })

  it('saveCell for custom:N uses empty array when currentBook is not provided', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'value', onSuccess)

    const result = onSuccess.mock.calls[0]![0] as Partial<BookCard>
    expect(result.customMetadata).toEqual([])
  })

  it('saveCell for custom:N shows error toast on API failure', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({ id: 5 })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:42', 'value', onSuccess, book)

    expect(onSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('saveCell for custom:N shows error toast for invalid field ID', async () => {
    const editor = useTableCellEditor()
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:notanumber', 'value', onSuccess)

    expect(mocks.api).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Cannot save: invalid custom field ID in "custom:notanumber"')
  })

  it('saveCell for custom:N saves boolean values correctly', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({
      id: 5,
      customMetadata: [{ fieldId: 7, key: 'featured', label: 'Featured', type: 'boolean', displayOrder: 0, value: false }],
    })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:7', true, onSuccess, book)

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/5/metadata',
      expect.objectContaining({ body: JSON.stringify({ customMetadata: [{ fieldId: 7, value: true }] }) }),
    )
    const result = onSuccess.mock.calls[0]![0] as Partial<BookCard>
    expect(result.customMetadata!.find((f) => f.fieldId === 7)?.value).toBe(true)
  })

  it('saveCell for custom:N saves number values correctly', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({
      id: 5,
      customMetadata: [{ fieldId: 3, key: 'score', label: 'Score', type: 'number', displayOrder: 0, value: null }],
    })
    const onSuccess = vi.fn<(patch: Partial<BookCard>) => void>()

    await editor.saveCell(5, 'custom:3', 95, onSuccess, book)

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/5/metadata',
      expect.objectContaining({ body: JSON.stringify({ customMetadata: [{ fieldId: 3, value: 95 }] }) }),
    )
    const result = onSuccess.mock.calls[0]![0] as Partial<BookCard>
    expect(result.customMetadata!.find((f) => f.fieldId === 3)?.value).toBe(95)
  })

  it('saveCell shows a friendly message when field is not enabled for the book library', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Custom metadata field 42 is not enabled for this book' }),
    } as Response)
    const editor = useTableCellEditor()
    const book = makeBook({ id: 5 })

    await editor.saveCell(5, 'custom:42', 'value', vi.fn<(patch: Partial<BookCard>) => void>(), book)

    expect(mocks.toastError).toHaveBeenCalledWith('This field is not available for this book - enable it for the library in Settings first')
  })
})
