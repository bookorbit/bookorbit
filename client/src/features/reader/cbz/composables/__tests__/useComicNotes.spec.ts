import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationItem } from '@bookorbit/types'

const store = vi.hoisted(() => ({
  create: vi.fn<(input: unknown) => Promise<unknown>>(),
  update: vi.fn<(id: number, patch: unknown) => Promise<unknown>>(),
  remove: vi.fn<(id: number) => Promise<boolean>>(),
}))

const annotations = ref<AnnotationItem[]>([])

vi.mock('../../../shared/composables/useFileAnnotations', () => ({
  useFileAnnotations: () => ({
    annotations,
    total: ref(0),
    loadError: ref(false),
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    load: vi.fn<() => Promise<boolean>>(),
    loadMore: vi.fn<() => Promise<boolean>>(),
    create: store.create,
    update: store.update,
    remove: store.remove,
  }),
}))

import { comicNotePage, useComicNotes } from '../useComicNotes'

function annotation(id: number, overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id,
    bookId: 7,
    cfi: null,
    jumpFileId: 70,
    pageno: null,
    text: '',
    color: '#38BDF8',
    style: 'highlight',
    note: `Note ${id}`,
    chapterTitle: null,
    origin: 'web',
    positionStatus: null,
    chapterIndex: null,
    highlightedAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('comicNotePage', () => {
  it('reads the page of a page note, a page-based position, then the page number', () => {
    expect(comicNotePage(annotation(1, { page: { page: 4 }, pageno: 5 }))).toBe(4)
    expect(comicNotePage(annotation(2, { pdf: { page: 2, rect: { x: 0, y: 0, width: 1, height: 1 }, rects: [] } }))).toBe(2)
    expect(comicNotePage(annotation(3, { pageno: 9 }))).toBe(8)
    expect(comicNotePage(annotation(4))).toBeNull()
  })
})

describe('useComicNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    annotations.value = []
  })

  it('lists notes in page order and leaves out anything without a page', () => {
    annotations.value = [
      annotation(1, { page: { page: 6 } }),
      annotation(2, { page: { page: 1 }, highlightedAt: '2026-11-21T10:00:00.000Z' }),
      annotation(3),
      annotation(4, { page: { page: 1 }, color: '#F472B6' }),
    ]
    const notes = useComicNotes(7, 70)

    expect(notes.notes.value.map((note) => [note.annotation.id, note.page])).toEqual([
      [4, 1],
      [2, 1],
      [1, 6],
    ])
    expect(notes.notesOn([1, 2]).map((note) => note.annotation.id)).toEqual([4, 2])
    expect(notes.markers.value).toEqual([
      { page: 1, color: '#F472B6' },
      { page: 6, color: '#38BDF8' },
    ])
  })

  it('creates a page note on this file and remembers the colour for the next one', async () => {
    store.create.mockResolvedValue(annotation(9, { page: { page: 3 } }))
    const notes = useComicNotes(7, 70)
    expect(notes.lastColor.value).toBe('#FACC15')

    await notes.addNote(3, 'Panel two mirrors issue 1', '#4ADE80')

    expect(store.create).toHaveBeenCalledWith({
      page: { page: 3 },
      bookFileId: 70,
      text: '',
      color: '#4ADE80',
      style: 'highlight',
      note: 'Panel two mirrors issue 1',
    })
    expect(useComicNotes(7, 70).lastColor.value).toBe('#4ADE80')
  })

  it('edits only the note and its colour', async () => {
    store.update.mockResolvedValue(annotation(9))
    const notes = useComicNotes(7, 70)

    await notes.editNote(9, 'Rewritten', '#F87171')

    expect(store.update).toHaveBeenCalledWith(9, { note: 'Rewritten', color: '#F87171' })
  })
})
