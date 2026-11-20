import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { AnnotationItem, AnnotationRect } from '@bookorbit/types'
import { usePdfHighlights } from '../composables/usePdfHighlights'

interface ApiResponse {
  ok: boolean
  json: () => Promise<unknown>
}

type PageRef = { kind: 'objectNumber'; objectNumber: number }
type TextPosition = { page: PageRef; index: number }
type SelectionEventName = 'onCommitted' | 'onChanged' | 'onCleared'
type SelectedPage = { pageIndex: number; rects: AnnotationRect[]; text: string }

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())

function pageRef(pageIndex: number): PageRef {
  return { kind: 'objectNumber', objectNumber: 100 + pageIndex }
}

const mocks = vi.hoisted(() => ({
  listeners: {} as Partial<Record<'onCommitted' | 'onChanged' | 'onCleared', () => void>>,
  selected: [] as { pageIndex: number; rects: { x: number; y: number; width: number; height: number }[]; text: string }[],
  selecting: false,
  canCopy: true,
  clear: vi.fn<() => void>(),
  readTextInRange: vi.fn<(range: { start: unknown; end: unknown }) => Promise<string>>(),
  reveal: vi.fn<(page: number, options: unknown) => void>(),
}))

const pages = ref(Array.from({ length: 5 }, (_, index) => ({ index, ref: pageRef(index) })))

function selectedPage(page: PageRef) {
  return mocks.selected.find((entry) => pageRef(entry.pageIndex).objectNumber === page.objectNumber)
}

vi.mock('@/lib/api', () => ({
  api: apiMock,
  getValidToken: () => Promise.resolve(null),
}))

vi.mock('@embedpdf/vue/runtime', () => ({ usePageList: () => pages }))

vi.mock('@embedpdf/vue/stage', () => ({ useStage: () => ({ reveal: mocks.reveal }) }))

vi.mock('@embedpdf/vue/selection', () => ({
  useSelection: () => ({
    getSnapshot: () => {
      const first = mocks.selected[0]
      const last = mocks.selected.at(-1)
      return {
        pages: mocks.selected.map((entry) => ({ page: pageRef(entry.pageIndex), segments: [] })),
        range: first && last ? { start: { page: pageRef(first.pageIndex), index: 3 }, end: { page: pageRef(last.pageIndex), index: 9 } } : null,
      }
    },
    listRects: (page: PageRef) => selectedPage(page)?.rects ?? [],
    getAnchor: () => {
      const first = mocks.selected[0]
      return first ? { page: pageRef(first.pageIndex), bounds: first.rects[0] } : null
    },
    readTextInRange: mocks.readTextInRange,
    canCopy: () => mocks.canCopy,
    isSelecting: () => mocks.selecting,
    clear: mocks.clear,
  }),
  useSelectionEvent: (select: (capability: Record<SelectionEventName, SelectionEventName>) => SelectionEventName, handler: () => void) => {
    const name = select({ onCommitted: 'onCommitted', onChanged: 'onChanged', onCleared: 'onCleared' })
    mocks.listeners[name] = handler
  },
}))

function response(ok: boolean, payload: unknown = null): ApiResponse {
  return {
    ok,
    json: async () => (Array.isArray(payload) ? { items: payload, total: payload.length, page: 1, pageSize: 100, stats: {} } : payload),
  }
}

const RECT = { x: 12, y: 20, width: 30, height: 8 }

function annotation(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 7,
    bookId: 9,
    cfi: null,
    jumpFileId: 33,
    pageno: 2,
    text: 'existing',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    highlightedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 1, rect: RECT, rects: [RECT] },
    ...overrides,
  }
}

type Highlights = ReturnType<typeof usePdfHighlights>

function mountHighlights(): { highlights: Highlights; unmount: () => void } {
  let highlights!: Highlights
  const wrapper = mount(
    defineComponent({
      setup() {
        highlights = usePdfHighlights({ bookId: 9, fileId: 33 })
        return () => h('div')
      },
    }),
  )
  return { highlights, unmount: () => wrapper.unmount() }
}

async function select(...selected: SelectedPage[]) {
  mocks.selected = selected
  mocks.listeners.onCommitted?.()
  await flushPromises()
}

function postBodies() {
  return apiMock.mock.calls.filter((call) => call[1]?.method === 'POST').map((call) => JSON.parse(String(call[1]?.body)))
}

describe('usePdfHighlights', () => {
  beforeEach(() => {
    apiMock.mockReset()
    vi.stubGlobal('fetch', apiMock)
    mocks.listeners = {}
    mocks.selected = []
    mocks.selecting = false
    mocks.canCopy = true
    mocks.clear.mockReset()
    mocks.reveal.mockReset()
    mocks.readTextInRange.mockReset()
    mocks.readTextInRange.mockImplementation(async ({ start }) => {
      const page = (start as TextPosition).page
      return ` ${selectedPage(page)?.text ?? ''} `
    })
  })

  it('shows the popup for a finished selection and persists a new highlight', async () => {
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return Promise.resolve(response(true, annotation({ id: 55, color: '#38BDF8', style: 'underline' })))
      return Promise.resolve(response(true, []))
    })

    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })

    expect(highlights.popupVisible.value).toBe(true)
    expect(highlights.selectedText.value).toBe('selected text')
    expect(highlights.overlappingAnnotationId.value).toBeNull()

    await highlights.applyHighlight('#38BDF8', 'underline')
    await flushPromises()

    expect(postBodies()).toEqual([
      expect.objectContaining({
        bookFileId: 33,
        color: '#38BDF8',
        style: 'underline',
        text: 'selected text',
        pdf: { page: 1, rect: RECT, rects: [RECT] },
      }),
    ])
    expect(highlights.annotations.value).toHaveLength(1)
    expect(mocks.clear).toHaveBeenCalled()
    expect(highlights.popupVisible.value).toBe(false)

    unmount()
  })

  it('saves geometry without text when the document forbids copying', async () => {
    apiMock.mockImplementation((_input, init) =>
      Promise.resolve(init?.method === 'POST' ? response(true, annotation({ id: 56 })) : response(true, [])),
    )
    mocks.canCopy = false

    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'secret' })

    expect(highlights.popupVisible.value).toBe(true)
    expect(highlights.selectedText.value).toBe('')
    expect(mocks.readTextInRange).not.toHaveBeenCalled()

    await highlights.applyHighlight('#FACC15', 'highlight')
    expect(postBodies()[0]).toMatchObject({ text: '', pdf: { page: 1 } })

    unmount()
  })

  it('reads each page of a multi-page selection up to the next page boundary', async () => {
    apiMock.mockResolvedValue(response(true, []))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    await select({ pageIndex: 1, rects: [RECT], text: 'page one' }, { pageIndex: 2, rects: [RECT], text: 'page two' })

    expect(highlights.selectedText.value).toBe('page one page two')
    expect(mocks.readTextInRange).toHaveBeenCalledWith({ start: { page: pageRef(1), index: 3 }, end: { page: pageRef(2), index: 0 } })
    expect(mocks.readTextInRange).toHaveBeenCalledWith({ start: { page: pageRef(2), index: 0 }, end: { page: pageRef(2), index: 9 } })

    unmount()
  })

  it('hides the popup while a new selection is dragged and when the selection is cleared', async () => {
    apiMock.mockResolvedValue(response(true, []))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })
    expect(highlights.popupVisible.value).toBe(true)

    mocks.selecting = true
    mocks.listeners.onChanged?.()
    expect(highlights.popupVisible.value).toBe(false)

    mocks.selecting = false
    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })
    expect(highlights.popupVisible.value).toBe(true)

    mocks.listeners.onCleared?.()
    expect(highlights.popupVisible.value).toBe(false)

    unmount()
  })

  it('only exposes this file’s pdf highlights', async () => {
    apiMock.mockResolvedValue(
      response(true, [
        annotation({ id: 7 }),
        annotation({ id: 8, jumpFileId: 99 }),
        annotation({ id: 9, cfi: 'epubcfi(/6/4)', pageno: null, pdf: null }),
      ]),
    )

    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    expect(highlights.annotations.value.map((item) => item.id)).toEqual([7])

    unmount()
  })

  it('edits an overlapping highlight and keeps its style when the update fails', async () => {
    apiMock.mockImplementation((_input, init) => Promise.resolve(init?.method === 'PATCH' ? response(false) : response(true, [annotation()])))

    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [{ x: 20, y: 22, width: 4, height: 4 }], text: 'existing' })
    expect(highlights.overlappingAnnotationId.value).toBe(7)

    expect(await highlights.applyHighlight('#38BDF8', 'underline')).toBe(false)

    expect(postBodies()).toHaveLength(0)
    expect(highlights.annotations.value[0]?.color).toBe('#FACC15')
    expect(highlights.popupVisible.value).toBe(true)

    unmount()
  })

  it('keeps the popup open and selection intact when creating a highlight fails', async () => {
    apiMock.mockImplementation((_input, init) => Promise.resolve(init?.method === 'POST' ? response(false) : response(true, [])))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })

    await highlights.applyHighlight('#38BDF8', 'highlight')
    await flushPromises()

    expect(highlights.popupVisible.value).toBe(true)
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(highlights.annotations.value).toHaveLength(0)

    unmount()
  })

  it('keeps the note dialog open and preserves typed text when saving a new note fails', async () => {
    apiMock.mockImplementation((_input, init) => Promise.resolve(init?.method === 'POST' ? response(false) : response(true, [])))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })

    highlights.openNoteDialog()
    highlights.noteText.value = 'draft note'
    await highlights.saveNote('draft note')
    await flushPromises()

    expect(highlights.showNoteDialog.value).toBe(true)
    expect(highlights.noteText.value).toBe('draft note')
    expect(mocks.clear).not.toHaveBeenCalled()

    unmount()
  })

  it('retries only the failed page of a multi-page selection without duplicating the saved one', async () => {
    let postCount = 0
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        postCount += 1
        // Page 1 succeeds, page 2 fails, and the retry of page 2 succeeds.
        const ok = postCount !== 2
        return Promise.resolve(response(ok, ok ? annotation({ id: 100 + postCount }) : null))
      }
      return Promise.resolve(response(true, []))
    })

    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'page one' }, { pageIndex: 2, rects: [RECT], text: 'page two' })

    await highlights.applyHighlight('#38BDF8', 'highlight')
    await flushPromises()
    expect(postCount).toBe(2)
    expect(highlights.popupVisible.value).toBe(true)

    await highlights.applyHighlight('#38BDF8', 'highlight')
    await flushPromises()
    expect(postCount).toBe(3)
    expect(postBodies().map((body) => [body.pdf.page, body.text])).toEqual([
      [1, 'page one'],
      [2, 'page two'],
      [2, 'page two'],
    ])
    expect(highlights.popupVisible.value).toBe(false)

    unmount()
  })

  it('serializes rapid highlight saves so one selection creates one annotation', async () => {
    let resolvePost!: (value: ApiResponse) => void
    const deferredPost = new Promise<ApiResponse>((resolve) => {
      resolvePost = resolve
    })
    apiMock.mockImplementation((_input, init) => (init?.method === 'POST' ? deferredPost : Promise.resolve(response(true, []))))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'selected text' })

    const first = highlights.applyHighlight('#38BDF8', 'highlight')
    const second = highlights.applyHighlight('#38BDF8', 'highlight')

    expect(highlights.isSaving.value).toBe(true)
    expect(await second).toBe(false)

    resolvePost(response(true, annotation({ id: 88 })))
    expect(await first).toBe(true)
    expect(postBodies()).toHaveLength(1)
    expect(highlights.annotations.value).toHaveLength(1)
    expect(highlights.isSaving.value).toBe(false)

    unmount()
  })

  it('clears popup selection state after deleting an overlapping annotation', async () => {
    apiMock.mockImplementation((_input, init) => Promise.resolve(init?.method === 'DELETE' ? response(true) : response(true, [annotation()])))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    await select({ pageIndex: 1, rects: [RECT], text: 'existing' })
    expect(highlights.overlappingAnnotationId.value).toBe(7)

    expect(await highlights.deleteAnnotation(7)).toBe(true)

    expect(highlights.overlappingAnnotationId.value).toBeNull()
    expect(highlights.popupVisible.value).toBe(false)
    expect(mocks.clear).toHaveBeenCalled()

    unmount()
  })

  it('reveals a highlight on its page', async () => {
    apiMock.mockResolvedValue(response(true, []))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    highlights.navigateTo(annotation({ pdf: { page: 3, rect: RECT, rects: [RECT] } }))

    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(3, { rect: RECT, align: { x: 'center', y: 0.3 }, behavior: 'smooth' })

    unmount()
  })
})
