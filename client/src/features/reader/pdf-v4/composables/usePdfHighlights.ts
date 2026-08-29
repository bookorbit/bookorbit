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
}

/**
 * Orchestrates PDF highlights: it renders persisted annotations through the
 * EmbedPDF annotation plugin, drives the selection popup, and keeps the database
 * (via usePdfAnnotations) as the single source of truth. The annotation plugin is
 * only a render surface, so no plugin events feed back into persistence.
 */
export function usePdfHighlights({ bookId, fileId, documentId, getSurface }: UsePdfHighlightsOptions) {
  const store = usePdfAnnotations(bookId)
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

  // Only this file's PDF highlights: a book may hold several files (e.g. an EPUB
  // and a PDF, or two PDFs), and their annotations share one book-scoped list.
  const fileAnnotations = computed(() => store.annotations.value.filter((annotation) => annotation.pdf != null && annotation.jumpFileId === fileId))

  const renderedIds = new Set<number>()
  let pendingSelection: PendingSelectionPage[] = []
  let initialRenderDone = false
  // Bumped on every placement and clear so a slow captureSelection() cannot
  // apply its result after the selection has already changed or been cleared.
  let selectionGeneration = 0

  function annScope() {
    return annotationCapability.value?.forDocument(documentId()) ?? null
  }
  function selScope() {
    return selectionCapability.value?.forDocument(documentId()) ?? null
  }

  function renderAnnotation(annotation: AnnotationItem) {
    const scope = annScope()
    if (!scope) return
    const built = buildPdfAnnotationObject(annotation)
    if (!built) return
    scope.createAnnotation(built.pageIndex, built.object)
    renderedIds.add(annotation.id)
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
      if (!renderedIds.has(annotation.id)) renderAnnotation(annotation)
    }
    initialRenderDone = true
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
    popupPosition.value = {
      x: baseLeft + offsetX + target.size.width / 2,
      y: placement.suggestTop ? baseTop + offsetY : baseTop + offsetY + target.size.height,
    }
    popupShowBelow.value = !placement.suggestTop
    return true
  }

  async function onMenuPlacement(placement: SelectionMenuPlacement | null) {
    const generation = ++selectionGeneration
    if (!placement || !placement.isVisible) {
      popupVisible.value = false
      return
    }
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
  async function createFromSelection(color: string, style: string, note: string | null): Promise<boolean> {
    let failed = false
    for (const entry of pendingSelection) {
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
      else failed = true
    }
    return !failed
  }

  async function applyHighlight(color: string, style: string, note?: string) {
    let ok: boolean
    if (overlappingAnnotationId.value !== null) {
      const patch: { color: string; style: string; note?: string } = { color, style }
      if (note !== undefined) patch.note = note
      ok = await restyleExisting(overlappingAnnotationId.value, patch)
    } else {
      ok = await createFromSelection(color, style, note ?? null)
    }
    // Keep the selection mark and popup on failure so the user can retry without losing it.
    if (!ok) return
    clearSelection()
    dismissPopup()
  }

  function openNoteDialog() {
    noteText.value = selectedAnnotation()?.note ?? ''
    showNoteDialog.value = true
    dismissPopup()
  }

  async function saveNote(note: string) {
    const ok =
      overlappingAnnotationId.value !== null
        ? await restyleExisting(overlappingAnnotationId.value, { note })
        : await createFromSelection(DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_STYLE, note)
    // Keep the dialog open and the typed note intact on failure so it is not lost.
    if (!ok) return
    showNoteDialog.value = false
    noteText.value = ''
    clearSelection()
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

  async function deleteAnnotation(id: number) {
    const annotation = store.annotations.value.find((entry) => entry.id === id) ?? null
    const removed = await store.remove(id)
    if (removed && annotation) unrenderAnnotation(annotation)
  }

  async function initialize() {
    await store.load()
    if (annScope()) renderAll()
  }

  watch(
    annotationCapability,
    (capability) => {
      if (capability && !initialRenderDone && fileAnnotations.value.length > 0) renderAll()
    },
    { immediate: true },
  )

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

  void initialize()

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
    applyHighlight,
    openNoteDialog,
    saveNote,
    cancelNoteDialog,
    dismissPopup,
    navigateTo,
    deleteAnnotation,
  }
}
