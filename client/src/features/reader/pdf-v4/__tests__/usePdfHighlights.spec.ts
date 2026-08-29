import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { PdfAnnotationSubtype } from '@embedpdf/models'
import type { SelectionMenuPlacement } from '@embedpdf/plugin-selection'
import { usePdfHighlights } from '../composables/usePdfHighlights'

interface ApiResponse {
  ok: boolean
  json: () => Promise<unknown>
}

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())

const mocks = vi.hoisted(() => {
  const rect = { origin: { x: 12, y: 20 }, size: { width: 30, height: 8 } }
  return {
    rect,
    annScope: {
      createAnnotation: vi.fn<(pageIndex: number, object: unknown) => void>(),
      purgeAnnotation: vi.fn<(pageIndex: number, id: string) => void>(),
    },
    selScope: {
      getFormattedSelection: vi.fn<() => Array<{ pageIndex: number; rect: unknown; segmentRects: unknown[] }>>(() => [
        { pageIndex: 1, rect, segmentRects: [rect] },
      ]),
      getSelectedText: vi.fn<() => { toPromise: () => Promise<string[]> }>(() => ({
        toPromise: () => Promise.resolve(['selected text']),
      })),
      clear: vi.fn<() => void>(),
    },
    scrollScope: {
      getRectPositionForPage: vi.fn<() => { origin: { x: number; y: number }; size: { width: number; height: number } }>(() => ({
        origin: { x: 100, y: 200 },
        size: { width: 40, height: 10 },
      })),
      scrollToPage: vi.fn<(options: Record<string, unknown>) => void>(),
    },
    viewportScope: {
      getMetrics: vi.fn<() => { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number }>(() => ({
        scrollLeft: 0,
        scrollTop: 0,
        clientWidth: 800,
        clientHeight: 600,
      })),
    },
    menuListeners: [] as Array<(placement: SelectionMenuPlacement | null) => void>,
  }
})

vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('@embedpdf/plugin-annotation/vue', () => ({
  useAnnotationCapability: () => ({ provides: { value: { forDocument: () => mocks.annScope } } }),
}))

vi.mock('@embedpdf/plugin-selection/vue', () => ({
  useSelectionCapability: () => ({ provides: { value: { forDocument: () => mocks.selScope } } }),
  useSelectionPlugin: () => ({
    plugin: {
      __v_isRef: true,
      value: {
        onMenuPlacement: (_docId: string, listener: (placement: SelectionMenuPlacement | null) => void) => {
          mocks.menuListeners.push(listener)
          return () => {}
        },
      },
    },
  }),
}))

vi.mock('@embedpdf/plugin-scroll/vue', () => ({
  useScroll: () => ({ provides: { value: mocks.scrollScope } }),
}))

const fakeSurface = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  querySelector: () => ({ getBoundingClientRect: () => ({ left: 12, top: 20, width: 400, height: 500 }) }),
} as unknown as HTMLElement

function response(ok: boolean, payload: unknown = null): ApiResponse {
  return { ok, json: async () => payload }
}

type Highlights = ReturnType<typeof usePdfHighlights>

function mountHighlights(): { highlights: Highlights; unmount: () => void } {
  let highlights!: Highlights
  const wrapper = mount(
    defineComponent({
      setup() {
        highlights = usePdfHighlights({ bookId: 9, fileId: 33, documentId: () => 'doc-1', getSurface: () => fakeSurface })
        return () => h('div')
      },
    }),
  )
  return { highlights, unmount: () => wrapper.unmount() }
}

const PLACEMENT: SelectionMenuPlacement = {
  pageIndex: 1,
  rect: mocks.rect,
  spaceAbove: 300,
  spaceBelow: 300,
  suggestTop: false,
  isVisible: true,
}

describe('usePdfHighlights', () => {
  beforeEach(() => {
    apiMock.mockReset()
    mocks.annScope.createAnnotation.mockReset()
    mocks.annScope.purgeAnnotation.mockReset()
    mocks.selScope.clear.mockReset()
    mocks.menuListeners.length = 0
  })

  it('shows the popup for a selection and persists then renders a new highlight', async () => {
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          response(true, {
            id: 55,
            bookId: 9,
            cfi: null,
            jumpFileId: 33,
            pageno: 2,
            text: 'selected text',
            color: '#38BDF8',
            style: 'underline',
            note: null,
            chapterTitle: null,
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            pdf: { page: 1, rect: { x: 12, y: 20, width: 30, height: 8 }, rects: [{ x: 12, y: 20, width: 30, height: 8 }] },
          }),
        )
      }
      return Promise.resolve(response(true, []))
    })

    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    expect(mocks.menuListeners).toHaveLength(1)
    mocks.menuListeners[0](PLACEMENT)
    await flushPromises()

    expect(highlights.popupVisible.value).toBe(true)
    expect(highlights.selectedText.value).toBe('selected text')
    expect(highlights.overlappingAnnotationId.value).toBeNull()

    await highlights.applyHighlight('#38BDF8', 'underline')
    await flushPromises()

    const postCall = apiMock.mock.calls.find((call) => call[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall![1]!.body))
    expect(body).toMatchObject({
      bookFileId: 33,
      color: '#38BDF8',
      style: 'underline',
      text: 'selected text',
      pdf: { page: 1, rects: [{ x: 12, y: 20, width: 30, height: 8 }] },
    })
    expect(mocks.annScope.createAnnotation).toHaveBeenCalledTimes(1)
    const [pageIndex, createdObject] = mocks.annScope.createAnnotation.mock.calls[0]
    const markup = createdObject as { type: number }
    expect(pageIndex).toBe(1)
    expect(markup.type).toBe(PdfAnnotationSubtype.UNDERLINE)
    expect(highlights.annotations.value).toHaveLength(1)
    expect(mocks.selScope.clear).toHaveBeenCalled()
    expect(highlights.popupVisible.value).toBe(false)

    unmount()
  })

  it('hides the popup when the selection is cleared', async () => {
    apiMock.mockResolvedValue(response(true, []))
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    mocks.menuListeners[0](PLACEMENT)
    await flushPromises()
    expect(highlights.popupVisible.value).toBe(true)

    mocks.menuListeners[0](null)
    await flushPromises()
    expect(highlights.popupVisible.value).toBe(false)

    unmount()
  })

  it('renders persisted highlights loaded from the server', async () => {
    apiMock.mockResolvedValue(
      response(true, [
        {
          id: 7,
          bookId: 9,
          cfi: null,
          jumpFileId: 33,
          pageno: 3,
          text: 'existing',
          color: '#FACC15',
          style: 'highlight',
          note: null,
          chapterTitle: null,
          origin: 'web',
          positionStatus: 'exact',
          chapterIndex: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          pdf: { page: 2, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
        },
      ]),
    )

    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    expect(highlights.annotations.value).toHaveLength(1)
    expect(mocks.annScope.createAnnotation).toHaveBeenCalledTimes(1)
    expect(mocks.annScope.createAnnotation.mock.calls[0][0]).toBe(2)

    unmount()
  })

  it('only exposes and renders this file’s pdf highlights', async () => {
    apiMock.mockResolvedValue(
      response(true, [
        {
          id: 7,
          bookId: 9,
          cfi: null,
          jumpFileId: 33,
          pageno: 3,
          text: 'this file',
          color: '#FACC15',
          style: 'highlight',
          note: null,
          chapterTitle: null,
          origin: 'web',
          positionStatus: 'exact',
          chapterIndex: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          pdf: { page: 2, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
        },
        {
          id: 8,
          bookId: 9,
          cfi: null,
          jumpFileId: 99,
          pageno: 1,
          text: 'other file',
          color: '#FACC15',
          style: 'highlight',
          note: null,
          chapterTitle: null,
          origin: 'web',
          positionStatus: 'exact',
          chapterIndex: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          pdf: { page: 0, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
        },
        {
          id: 9,
          bookId: 9,
          cfi: 'epubcfi(/6/4)',
          jumpFileId: 33,
          pageno: null,
          text: 'epub',
          color: '#FACC15',
          style: 'highlight',
          note: null,
          chapterTitle: null,
          origin: 'web',
          positionStatus: 'exact',
          chapterIndex: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          pdf: null,
        },
      ]),
    )

    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    expect(highlights.annotations.value.map((annotation) => annotation.id)).toEqual([7])
    expect(mocks.annScope.createAnnotation).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('keeps the highlight rendered when a restyle update fails', async () => {
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'PATCH') return Promise.resolve(response(false))
      return Promise.resolve(
        response(true, [
          {
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
            createdAt: '2026-01-01T00:00:00.000Z',
            pdf: { page: 1, rect: { x: 12, y: 20, width: 30, height: 8 }, rects: [{ x: 12, y: 20, width: 30, height: 8 }] },
          },
        ]),
      )
    })

    const { highlights, unmount } = mountHighlights()
    await flushPromises()
    expect(mocks.annScope.createAnnotation).toHaveBeenCalledTimes(1)

    mocks.menuListeners[0](PLACEMENT)
    await flushPromises()
    expect(highlights.overlappingAnnotationId.value).toBe(7)

    await highlights.applyHighlight('#38BDF8', 'underline')
    await flushPromises()

    expect(mocks.annScope.purgeAnnotation).not.toHaveBeenCalled()
    expect(mocks.annScope.createAnnotation).toHaveBeenCalledTimes(1)
    expect(highlights.annotations.value[0].color).toBe('#FACC15')

    unmount()
  })

  it('keeps the popup open and selection intact when creating a highlight fails', async () => {
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return Promise.resolve(response(false))
      return Promise.resolve(response(true, []))
    })
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    mocks.menuListeners[0](PLACEMENT)
    await flushPromises()
    expect(highlights.popupVisible.value).toBe(true)

    await highlights.applyHighlight('#38BDF8', 'highlight')
    await flushPromises()

    expect(highlights.popupVisible.value).toBe(true)
    expect(mocks.selScope.clear).not.toHaveBeenCalled()
    expect(mocks.annScope.createAnnotation).not.toHaveBeenCalled()

    unmount()
  })

  it('keeps the note dialog open and preserves typed text when saving a new note fails', async () => {
    apiMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return Promise.resolve(response(false))
      return Promise.resolve(response(true, []))
    })
    const { highlights, unmount } = mountHighlights()
    await flushPromises()

    mocks.menuListeners[0](PLACEMENT)
    await flushPromises()

    highlights.openNoteDialog()
    highlights.noteText.value = 'draft note'
    await highlights.saveNote('draft note')
    await flushPromises()

    expect(highlights.showNoteDialog.value).toBe(true)
    expect(highlights.noteText.value).toBe('draft note')
    expect(mocks.selScope.clear).not.toHaveBeenCalled()

    unmount()
  })
})
