import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../useAnnotations'
import { useReaderMarksRefresh } from '../useReaderMarksRefresh'

function mark(id: number, cfi: string, color = '#FACC15', style = 'highlight'): Annotation {
  return {
    id,
    bookId: 9,
    cfi,
    jumpFileId: 33,
    pageno: null,
    text: 'text',
    color,
    style,
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    highlightedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeHarness(current: Annotation[], next: Annotation[] | 'fail', canRefresh = true) {
  const annotationItems = ref<Annotation[]>(current)
  const loadError = ref<string | null>(null)
  const annotations = {
    annotations: annotationItems,
    loadError,
    load: vi.fn<() => Promise<void>>(async () => {
      if (next === 'fail') loadError.value = 'Failed to load'
      else annotationItems.value = next
    }),
  }
  const bookmarks = { load: vi.fn<() => Promise<void>>(async () => {}) }
  const draw = {
    addAnnotation: vi.fn<(cfi: string, color: string, style: string) => void>(),
    redrawAnnotation: vi.fn<(cfi: string, color: string, style: string) => void>(),
    deleteAnnotation: vi.fn<(cfi: string) => void>(),
  }
  const { refreshMarks } = useReaderMarksRefresh({ bookId: 9, fileId: 33, annotations, bookmarks, canRefresh: () => canRefresh, ...draw })
  return { refreshMarks, annotations, bookmarks, ...draw }
}

describe('useReaderMarksRefresh', () => {
  it('draws marks made elsewhere, redraws recolored ones and erases deleted ones', async () => {
    const { refreshMarks, annotations, bookmarks, addAnnotation, redrawAnnotation, deleteAnnotation } = makeHarness(
      [mark(1, 'cfi-kept'), mark(2, 'cfi-recolored'), mark(3, 'cfi-deleted')],
      [mark(1, 'cfi-kept'), mark(2, 'cfi-recolored', '#F472B6', 'underline'), mark(4, 'cfi-new', '#4ADE80')],
    )

    await refreshMarks(100_000)

    expect(annotations.load).toHaveBeenCalledWith(9, 33)
    expect(bookmarks.load).toHaveBeenCalledWith(9, 33)
    expect(deleteAnnotation.mock.calls).toEqual([['cfi-deleted']])
    expect(addAnnotation.mock.calls).toEqual([['cfi-new', '#4ADE80', 'highlight']])
    expect(redrawAnnotation.mock.calls).toEqual([['cfi-recolored', '#F472B6', 'underline']])
  })

  it('leaves the page as drawn when the list cannot be loaded', async () => {
    const { refreshMarks, addAnnotation, deleteAnnotation } = makeHarness([mark(1, 'cfi-kept')], 'fail')

    await refreshMarks(100_000)

    expect(deleteAnnotation).not.toHaveBeenCalled()
    expect(addAnnotation).not.toHaveBeenCalled()
  })

  it('waits for the first draw and asks at most once per interval', async () => {
    const blocked = makeHarness([], [], false)
    await blocked.refreshMarks(100_000)
    expect(blocked.annotations.load).not.toHaveBeenCalled()

    const { refreshMarks, annotations } = makeHarness([], [])
    await refreshMarks(100_000)
    await refreshMarks(105_000)
    await refreshMarks(116_000)
    expect(annotations.load).toHaveBeenCalledTimes(2)
  })
})
