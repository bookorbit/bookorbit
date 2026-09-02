import { computed, onUnmounted, ref, watch } from 'vue'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import { useSelectionCapability, useSelectionPlugin } from '@embedpdf/plugin-selection/vue'
import type { SelectionMenuPlacement } from '@embedpdf/plugin-selection'
import type { AnnotationItem, AnnotationRect } from '@bookorbit/types'
import { usePdfAnnotations } from './usePdfAnnotations'
import { boundingRect, buildPdfAnnotationObject, findOverlappingAnnotation, fromRect, toPdfPosition } from '../lib/pdf-annotation-render'

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
  documentId: () => string
  /** The positioned viewer surface that hosts the page layers and the popup. */
  getSurface: () => HTMLElement | null
  getPopup: () => HTMLElement | null
}

/**
 * Orchestrates PDF highlights: it renders persisted annotations through the
 * EmbedPDF annotation plugin, drives the selection popup, and keeps the database
 * (via usePdfAnnotations) as the single source of truth. The annotation plugin is
 * only a render surface, so no plugin events feed back into persistence.
 */
export function usePdfHighlights({ bookId, fileId, documentId, getSurface, getPopup }: UsePdfHighlightsOptions) {
  const store = usePdfAnnotations(bookId, fileId)
  const { provides: annotationCapability } = useAnnotationCapability()
  const { provides: selectionCapability } = useSelectionCapability()
  const { plugin: selectionPlugin } = useSelectionPlugin()
  const { provides: scroll } = useScroll(documentId)

  const popupVisible = ref(false)
  const popupPosition = ref({ x: 0, y: 0 })
  const popupShowBelow = ref(false)
  const selectedText = ref('')
  const overlappingAnnotationId = ref<number | null>(null)
  const showNoteDialog = ref(false)
  const noteText = ref('')
  const isSaving = ref(false)

  // Only this file's PDF highlights: a book may hold several files (e.g. an EPUB
  // and a PDF, or two PDFs), and their annotations share one book-scoped list.
  const fileAnnotations = computed(() => store.annotations.value.filter((annotation) => annotation.pdf != null && annotation.jumpFileId === fileId))

  const renderedIds = new Set<number>()
  let pendingSelection: PendingSelectionPage[] = []
  // Bumped on every placement and clear so a slow captureSelection() cannot
  // apply its result after the selection has already changed or been cleared.
  let selectionGeneration = 0
  let lastPlacement: SelectionMenuPlacement | null = null

  function annScope() {
    return annotationCapability.value?.forDocument(documentId()) ?? null
  }
  function selScope() {
    return selectionCapability.value?.forDocument(documentId()) ?? null
  }

  function renderAnnotation(annotation: AnnotationItem): boolean {
    const scope = annScope()
    if (!scope) return false
    const built = buildPdfAnnotationObject(annotation)
    if (!built) return false
    try {
      if (scope.getAnnotationById(built.object.id)) {
        renderedIds.add(annotation.id)
        return true
      }
      renderedIds.delete(annotation.id)
      scope.createAnnotation(built.pageIndex, built.object)
      if (!scope.getAnnotationById(built.object.id)) return false
      renderedIds.add(annotation.id)
      return true
    } catch {
      return false
    }
  }

  function unrenderAnnotation(annotation: AnnotationItem) {
    const scope = annScope()
    if (!scope || !annotation.pdf) return
    scope.purgeAnnotation(annotation.pdf.page, `bo-${annotation.id}`)
    renderedIds.delete(annotation.id)
  }

  function renderAll() {
    const scope = annScope()
    if (!scope) return
    for (const annotation of fileAnnotations.value) {
      renderAnnotation(annotation)
    }
  }

  async function captureSelection(): Promise<PendingSelectionPage[]> {
    const scope = selScope()
    if (!scope) return []
    const formatted = scope.getFormattedSelection()
    if (formatted.length === 0) return []
    let texts: string[] = []
    try {
      texts = await scope.getSelectedText().toPromise()
    } catch {
      texts = []
    }
    return formatted.map((entry, index) => ({
      page: entry.pageIndex,
      rects: entry.segmentRects.map(fromRect),
      text: (texts[index] ?? '').trim(),
    }))
  }

  // The scroll/viewport metrics express positions in content space; they do not
  // include the CSS gap that horizontally centres a page narrower than the
  // viewer. So anchor to the real page element (which carries that gap plus the
  // scroll offset and zoom) and add the rect's page-local offset, derived from the
  // API so it stays scale- and rotation-correct. Coordinates are relative to the
  // viewer surface, which is the popup's offset parent.
  function positionPopup(placement: SelectionMenuPlacement) {
    const scope = scroll.value
    const surface = getSurface()
    if (!scope || !surface) return false
    const pageEl = surface.querySelector(`[data-page-index="${placement.pageIndex}"]`)
    const target = scope.getRectPositionForPage(placement.pageIndex, placement.rect)
    const pageOrigin = scope.getRectPositionForPage(placement.pageIndex, { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } })
    if (!pageEl || !target || !pageOrigin) return false
    const surfaceRect = surface.getBoundingClientRect()
    const pageRect = pageEl.getBoundingClientRect()
    const baseLeft = pageRect.left - surfaceRect.left
    const baseTop = pageRect.top - surfaceRect.top
    const offsetX = target.origin.x - pageOrigin.origin.x
    const offsetY = target.origin.y - pageOrigin.origin.y
    const popup = getPopup()
    const popupWidth = popup?.offsetWidth ?? 160
    const popupHeight = popup?.offsetHeight ?? 46
    const margin = 8
    const anchorX = baseLeft + offsetX + target.size.width / 2
    const anchorY = placement.suggestTop ? baseTop + offsetY : baseTop + offsetY + target.size.height
    const maxX = Math.max(margin, surfaceRect.width - popupWidth - margin)
    const maxY = Math.max(margin, surfaceRect.height - popupHeight - margin)
    popupPosition.value = {
      x: Math.min(Math.max(anchorX - popupWidth / 2, margin), maxX),
      y: Math.min(Math.max(placement.suggestTop ? anchorY - popupHeight - margin : anchorY + margin, margin), maxY),
    }
    popupShowBelow.value = !placement.suggestTop
    return true
  }

  async function onMenuPlacement(placement: SelectionMenuPlacement | null) {
    const generation = ++selectionGeneration
    if (!placement || !placement.isVisible) {
      lastPlacement = null
      popupVisible.value = false
      return
    }
    lastPlacement = placement
    if (!positionPopup(placement)) return
    const selectionRect = fromRect(placement.rect)
    const overlapping = findOverlappingAnnotation(fileAnnotations.value, placement.pageIndex, selectionRect)?.id ?? null
    const captured = await captureSelection()
    if (generation !== selectionGeneration) return
    overlappingAnnotationId.value = overlapping
    pendingSelection = captured
    selectedText.value = captured
      .map((entry) => entry.text)
      .join(' ')
      .trim()
    popupVisible.value = true
  }

  function dismissPopup() {
    popupVisible.value = false
    lastPlacement = null
  }

  function repositionPopup() {
    if (lastPlacement) positionPopup(lastPlacement)
  }

  function clearSelection() {
    selectionGeneration += 1
    selScope()?.clear()
    pendingSelection = []
    overlappingAnnotationId.value = null
  }

  function selectedAnnotation(): AnnotationItem | null {
    const id = overlappingAnnotationId.value
    if (id === null) return null
    return fileAnnotations.value.find((annotation) => annotation.id === id) ?? null
  }

  async function restyleExisting(id: number, patch: { color?: string; style?: string; note?: string | null }): Promise<boolean> {
    const previous = fileAnnotations.value.find((annotation) => annotation.id === id) ?? null
    const updated = await store.update(id, patch)
    if (!updated) return false
    if (previous) unrenderAnnotation(previous)
    renderAnnotation(updated)
    return true
  }
  async function createFromSelection(
    selection: PendingSelectionPage[],
    color: string,
    style: string,
    note: string | null,
  ): Promise<{ ok: boolean; remaining: PendingSelectionPage[] }> {
    const remaining: PendingSelectionPage[] = []
    for (const entry of selection) {
      if (entry.rects.length === 0) continue
      const created = await store.create({
        pdf: toPdfPosition(entry.page, entry.rects),
        bookFileId: fileId,
        text: entry.text,
        color,
        style,
        note,
      })
      if (created) renderAnnotation(created)
      else remaining.push(entry)
    }
    return { ok: remaining.length === 0, remaining }
  }

  async function applyHighlight(color: string, style: string, note?: string): Promise<boolean> {
    if (isSaving.value) return false
    const generation = selectionGeneration
    const annotationId = overlappingAnnotationId.value
    const selection = pendingSelection.map((entry) => ({ ...entry, rects: entry.rects.map((rect) => ({ ...rect })) }))
    isSaving.value = true
    try {
      let ok: boolean
      if (annotationId !== null) {
        const patch: { color: string; style: string; note?: string } = { color, style }
        if (note !== undefined) patch.note = note
        ok = await restyleExisting(annotationId, patch)
      } else {
        const result = await createFromSelection(selection, color, style, note ?? null)
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
    const selection = pendingSelection.map((entry) => ({ ...entry, rects: entry.rects.map((rect) => ({ ...rect })) }))
    isSaving.value = true
    try {
      let ok: boolean
      if (annotationId !== null) ok = await restyleExisting(annotationId, { note })
      else {
        const result = await createFromSelection(selection, DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_STYLE, note)
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
    const bounds = annotation.pdf.rect ?? boundingRect(annotation.pdf.rects)
    scroll.value?.scrollToPage({
      pageNumber: annotation.pdf.page + 1,
      pageCoordinates: { x: bounds.x, y: bounds.y },
      alignX: 50,
      alignY: 30,
      behavior: 'smooth',
    })
  }

  async function deleteAnnotation(id: number): Promise<boolean> {
    const annotation = store.annotations.value.find((entry) => entry.id === id) ?? null
    const removed = await store.remove(id)
    if (removed && annotation) unrenderAnnotation(annotation)
    if (!removed) return false
    if (overlappingAnnotationId.value === id) {
      showNoteDialog.value = false
      noteText.value = ''
      clearSelection()
      dismissPopup()
    }
    return true
  }

  function clearRenderedAnnotations() {
    for (const annotation of fileAnnotations.value) {
      if (renderedIds.has(annotation.id)) unrenderAnnotation(annotation)
    }
    renderedIds.clear()
  }

  async function retryLoad() {
    clearRenderedAnnotations()
    const loaded = await store.load()
    if (loaded && annScope()) renderAll()
    return loaded
  }

  async function loadMore() {
    return store.loadMore()
  }

  watch(
    [annotationCapability, () => documentId()],
    ([capability, docId], _previous, onCleanup) => {
      if (!capability || !docId) return
      const scope = capability.forDocument(docId)
      const unsubscribe = scope.onAnnotationEvent((event) => {
        if (event.type === 'loaded') renderAll()
      })
      if (fileAnnotations.value.length > 0) renderAll()
      onCleanup(unsubscribe)
    },
    { immediate: true },
  )

  watch(fileAnnotations, () => {
    if (annScope()) renderAll()
  })

  watch(
    [selectionPlugin, () => documentId()],
    ([plugin, docId], _prev, onCleanup) => {
      if (!plugin || !docId) return
      const unsubscribe = plugin.onMenuPlacement(docId, (placement) => void onMenuPlacement(placement))
      onCleanup(unsubscribe)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    renderedIds.clear()
  })

  void retryLoad()

  return {
    annotations: fileAnnotations,
    loadError: store.loadError,
    popupVisible,
    popupPosition,
    popupShowBelow,
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
    repositionPopup,
    retryLoad,
    loadMore,
    renderAll,
    navigateTo,
    deleteAnnotation,
  }
}
