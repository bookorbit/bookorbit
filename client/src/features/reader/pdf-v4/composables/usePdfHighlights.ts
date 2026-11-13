import { computed, ref } from 'vue'
import { usePageList, type PageRef } from '@embedpdf/vue/runtime'
import { useSelection, useSelectionEvent, type TextRange } from '@embedpdf/vue/selection'
import { useStage } from '@embedpdf/vue/stage'
import type { AnnotationItem, AnnotationRect } from '@bookorbit/types'
import { usePdfAnnotations } from './usePdfAnnotations'
import { boundingRect, findOverlappingAnnotation, toAnnotationRect, toPdfPosition } from '../lib/pdf-annotation-render'

const DEFAULT_HIGHLIGHT_COLOR = '#FACC15'
const DEFAULT_HIGHLIGHT_STYLE = 'highlight'

interface PendingSelectionPage {
  page: number
  rects: AnnotationRect[]
  text: string
}

interface UsePdfHighlightsOptions {
  bookId: number
  fileId: number
}

function samePage(a: PageRef, b: PageRef) {
  return a.objectNumber === b.objectNumber
}

/**
 * Orchestrates PDF highlights: the database (via usePdfAnnotations) is the single source of
 * truth, the page layer draws what it holds, and the selection feeds the popup. Nothing is
 * written into the PDF itself.
 */
export function usePdfHighlights({ bookId, fileId }: UsePdfHighlightsOptions) {
  const store = usePdfAnnotations(bookId, fileId)
  const selection = useSelection()
  const stage = useStage()
  const pages = usePageList()

  const popupVisible = ref(false)
  const selectedText = ref('')
  const overlappingAnnotationId = ref<number | null>(null)
  const showNoteDialog = ref(false)
  const noteText = ref('')
  const isSaving = ref(false)

  // Only this file's PDF highlights: a book may hold several files (e.g. an EPUB
  // and a PDF, or two PDFs), and their annotations share one book-scoped list.
  const fileAnnotations = computed(() => store.annotations.value.filter((annotation) => annotation.pdf != null && annotation.jumpFileId === fileId))
  const pageIndexByObject = computed(() => new Map(pages.value.map((page) => [page.ref.objectNumber, page.index])))

  let pendingSelection: PendingSelectionPage[] = []
  // Bumped on every new selection and clear so a slow captureSelection() cannot
  // apply its result after the selection has already changed or been cleared.
  let selectionGeneration = 0

  function pageIndexOf(page: PageRef): number | null {
    return pageIndexByObject.value.get(page.objectNumber) ?? null
  }

  function canCopy() {
    try {
      return selection.canCopy()
    } catch {
      return false
    }
  }

  // A range can span pages; each page's text is read on its own so every highlight row carries
  // only the words it covers. A range ending at the next page's first character ends this page.
  async function readPageText(range: TextRange, page: PageRef, pageIndex: number): Promise<string> {
    const start = samePage(range.start.page, page) ? range.start : { page, index: 0 }
    const next = pages.value[pageIndex + 1]
    const end = samePage(range.end.page, page) || !next ? range.end : { page: next.ref, index: 0 }
    try {
      return (await selection.readTextInRange({ start, end })).trim()
    } catch {
      return ''
    }
  }

  async function captureSelection(): Promise<PendingSelectionPage[]> {
    const snapshot = selection.getSnapshot()
    const range = snapshot.range
    if (!range) return []
    const withText = canCopy()
    const captured = await Promise.all(
      snapshot.pages.map(async ({ page }): Promise<PendingSelectionPage | null> => {
        const pageIndex = pageIndexOf(page)
        if (pageIndex === null) return null
        const rects = selection.listRects(page).map(toAnnotationRect)
        if (rects.length === 0) return null
        return { page: pageIndex, rects, text: withText ? await readPageText(range, page, pageIndex) : '' }
      }),
    )
    return captured.filter((entry): entry is PendingSelectionPage => entry !== null)
  }

  async function handleSelectionSettled() {
    const generation = ++selectionGeneration
    let anchor: ReturnType<typeof selection.getAnchor>
    try {
      anchor = selection.getAnchor()
    } catch {
      anchor = null
    }
    const anchorPage = anchor ? pageIndexOf(anchor.page) : null
    if (!anchor || anchorPage === null) {
      popupVisible.value = false
      return
    }
    const overlapping = findOverlappingAnnotation(fileAnnotations.value, anchorPage, toAnnotationRect(anchor.bounds))?.id ?? null
    let captured: PendingSelectionPage[]
    try {
      captured = await captureSelection()
    } catch {
      captured = []
    }
    if (generation !== selectionGeneration) return
    overlappingAnnotationId.value = overlapping
    pendingSelection = captured
    selectedText.value = captured
      .map((entry) => entry.text)
      .join(' ')
      .trim()
    popupVisible.value = captured.length > 0
  }

  function handleSelectionChanged() {
    if (!selection.isSelecting()) return
    selectionGeneration += 1
    popupVisible.value = false
  }

  function handleSelectionCleared() {
    selectionGeneration += 1
    popupVisible.value = false
    pendingSelection = []
    overlappingAnnotationId.value = null
  }

  useSelectionEvent(
    (capability) => capability.onCommitted,
    () => void handleSelectionSettled(),
  )
  useSelectionEvent((capability) => capability.onChanged, handleSelectionChanged)
  useSelectionEvent((capability) => capability.onCleared, handleSelectionCleared)

  function dismissPopup() {
    popupVisible.value = false
  }

  function clearSelection() {
    selectionGeneration += 1
    try {
      selection.clear()
    } catch {
      // No document is open, so there is nothing selected to clear.
    }
    pendingSelection = []
    overlappingAnnotationId.value = null
  }

  function selectedAnnotation(): AnnotationItem | null {
    const id = overlappingAnnotationId.value
    if (id === null) return null
    return fileAnnotations.value.find((annotation) => annotation.id === id) ?? null
  }

  async function createFromSelection(
    pendingPages: PendingSelectionPage[],
    color: string,
    style: string,
    note: string | null,
  ): Promise<{ ok: boolean; remaining: PendingSelectionPage[] }> {
    const remaining: PendingSelectionPage[] = []
    for (const entry of pendingPages) {
      if (entry.rects.length === 0) continue
      const created = await store.create({
        pdf: toPdfPosition(entry.page, entry.rects),
        bookFileId: fileId,
        text: entry.text,
        color,
        style,
        note,
      })
      if (!created) remaining.push(entry)
    }
    return { ok: remaining.length === 0, remaining }
  }

  function copyPendingSelection() {
    return pendingSelection.map((entry) => ({ ...entry, rects: entry.rects.map((rect) => ({ ...rect })) }))
  }

  async function applyHighlight(color: string, style: string, note?: string): Promise<boolean> {
    if (isSaving.value) return false
    const generation = selectionGeneration
    const annotationId = overlappingAnnotationId.value
    const pendingPages = copyPendingSelection()
    isSaving.value = true
    try {
      let ok: boolean
      if (annotationId !== null) {
        const patch: { color: string; style: string; note?: string } = { color, style }
        if (note !== undefined) patch.note = note
        ok = (await store.update(annotationId, patch)) !== null
      } else {
        const result = await createFromSelection(pendingPages, color, style, note ?? null)
        ok = result.ok
        if (generation === selectionGeneration) pendingSelection = result.remaining
      }
      if (!ok || generation !== selectionGeneration) return ok
      clearSelection()
      dismissPopup()
      return true
    } finally {
      isSaving.value = false
    }
  }

  function openNoteDialog() {
    noteText.value = selectedAnnotation()?.note ?? ''
    showNoteDialog.value = true
    dismissPopup()
  }

  async function saveNote(note: string): Promise<boolean> {
    if (isSaving.value) return false
    const generation = selectionGeneration
    const annotationId = overlappingAnnotationId.value
    const pendingPages = copyPendingSelection()
    isSaving.value = true
    try {
      let ok: boolean
      if (annotationId !== null) ok = (await store.update(annotationId, { note })) !== null
      else {
        const result = await createFromSelection(pendingPages, DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_STYLE, note)
        ok = result.ok
        if (generation === selectionGeneration) pendingSelection = result.remaining
      }
      if (!ok || generation !== selectionGeneration) return ok
      showNoteDialog.value = false
      noteText.value = ''
      clearSelection()
      return true
    } finally {
      isSaving.value = false
    }
  }

  function cancelNoteDialog() {
    showNoteDialog.value = false
    noteText.value = ''
  }

  function navigateTo(annotation: AnnotationItem) {
    if (!annotation.pdf) return
    const rect = annotation.pdf.rect ?? boundingRect(annotation.pdf.rects)
    try {
      stage.reveal(annotation.pdf.page, { rect, align: { x: 'center', y: 0.3 }, behavior: 'smooth' })
    } catch {
      // The document closed or is still opening; there is no view to move.
    }
  }

  async function deleteAnnotation(id: number): Promise<boolean> {
    const removed = await store.remove(id)
    if (!removed) return false
    if (overlappingAnnotationId.value === id) {
      showNoteDialog.value = false
      noteText.value = ''
      clearSelection()
      dismissPopup()
    }
    return true
  }

  function retryLoad() {
    return store.load()
  }

  function loadMore() {
    return store.loadMore()
  }

  void retryLoad()

  return {
    annotations: fileAnnotations,
    loadError: store.loadError,
    popupVisible,
    selectedText,
    overlappingAnnotationId,
    showNoteDialog,
    noteText,
    isSaving,
    loading: store.loading,
    loadingMore: store.loadingMore,
    hasMore: store.hasMore,
    applyHighlight,
    openNoteDialog,
    saveNote,
    cancelNoteDialog,
    dismissPopup,
    retryLoad,
    loadMore,
    navigateTo,
    deleteAnnotation,
  }
}
