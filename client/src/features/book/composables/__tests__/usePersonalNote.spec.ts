import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@bookorbit/types'

import { PERSONAL_NOTE_MAX_LENGTH, usePersonalNote } from '../usePersonalNote'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    libraryName: 'Test Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

describe('usePersonalNote', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('seeds the draft from the book and reports no unsaved changes', () => {
    const book = ref(makeBook({ personalNote: 'Existing note' }))
    const { draft, hasNote, preview, canSave } = usePersonalNote(book)

    expect(draft.value).toBe('Existing note')
    expect(hasNote.value).toBe(true)
    expect(preview.value).toBe('Existing note')
    expect(canSave.value).toBe(false)
  })

  it('resets the draft when the book id changes', async () => {
    const book = ref(makeBook({ id: 1, personalNote: 'First book note' }))
    const { draft, startEdit } = usePersonalNote(book)

    startEdit()
    draft.value = 'Unsaved edits'

    book.value = makeBook({ id: 2, personalNote: 'Second book note' })
    await nextTick()

    expect(draft.value).toBe('Second book note')
  })

  it('canSave is true only when the trimmed draft differs from the saved note', () => {
    const book = ref(makeBook({ personalNote: 'Saved' }))
    const { draft, canSave } = usePersonalNote(book)

    draft.value = 'Saved'
    expect(canSave.value).toBe(false)

    draft.value = '  Saved  '
    expect(canSave.value).toBe(false)

    draft.value = 'Changed'
    expect(canSave.value).toBe(true)
  })

  it('clearDraft empties the draft so a blank note can be saved', () => {
    const book = ref(makeBook({ personalNote: 'Something' }))
    const { draft, clearDraft, canClearDraft } = usePersonalNote(book)

    expect(canClearDraft.value).toBe(true)
    clearDraft()
    expect(draft.value).toBe('')
  })

  it('save sends the trimmed note and returns the updated book', async () => {
    const updated = makeBook({ personalNote: 'Trimmed note', personalNoteUpdatedAt: '2026-07-01T00:00:00.000Z' })
    apiMock.mockResolvedValue({ ok: true, json: async () => updated })

    const book = ref(makeBook())
    const { draft, save, editing } = usePersonalNote(book)
    draft.value = '  Trimmed note  '
    editing.value = true

    const result = await save()

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/1/personal-note')
    expect(req.method).toBe('PATCH')
    expect(JSON.parse(String(req.body))).toEqual({ note: 'Trimmed note' })
    expect(result).toEqual(updated)
    expect(editing.value).toBe(false)
  })

  it('save is a no-op when there are no changes', async () => {
    const book = ref(makeBook({ personalNote: 'Same' }))
    const { save } = usePersonalNote(book)

    const result = await save()

    expect(apiMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('sets an error and keeps editing open on a failed save', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500 })

    const book = ref(makeBook())
    const { draft, save, error, editing } = usePersonalNote(book)
    draft.value = 'Changed'
    editing.value = true

    const result = await save()

    expect(result).toBeNull()
    expect(error.value).toBe('Failed to save personal review.')
    expect(editing.value).toBe(true)
  })

  it('cancelEdit discards draft changes and closes the editor', () => {
    const book = ref(makeBook({ personalNote: 'Saved note' }))
    const { draft, editing, startEdit, cancelEdit } = usePersonalNote(book)

    startEdit()
    draft.value = 'Unsaved change'
    cancelEdit()

    expect(draft.value).toBe('Saved note')
    expect(editing.value).toBe(false)
  })

  it('exposes the max length constant used by the template', () => {
    expect(PERSONAL_NOTE_MAX_LENGTH).toBe(10000)
  })
})
