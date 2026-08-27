import { onUnmounted, ref, watch } from 'vue'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import { useSelectionCapability, useSelectionPlugin } from '@embedpdf/plugin-selection/vue'
import { useViewportCapability } from '@embedpdf/plugin-viewport/vue'
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
}

/**
 * Orchestrates PDF highlights: it renders persisted annotations through the
 * EmbedPDF annotation plugin, drives the selection popup, and keeps the database
 * (via usePdfAnnotations) as the single source of truth. The annotation plugin is
 * only a render surface, so no plugin events feed back into persistence.
 */
export function usePdfHighlights({ bookId, fileId, documentId }: UsePdfHighlightsOptions) {
  const store = usePdfAnnotations(bookId)
  const { provides: annotationCapability } = useAnnotationCapability()
  const { provides: selectionCapability } = useSelectionCapability()
  const { plugin: selectionPlugin } = useSelectionPlugin()
  const { provides: scroll } = useScroll(documentId)
  const { provides: viewportCapability } = useViewportCapability()

  const popupVisible = ref(false)
  const popupPosition = ref({ x: 0, y: 0 })
  const popupShowBelow = ref(false)
  const selectedText = ref('')
  const overlappingAnnotationId = ref<number | null>(null)
  const showNoteDialog = ref(false)
  const noteText = ref('')

  const renderedIds = new Set<number>()
  let pendingSelection: PendingSelectionPage[] = []
  let initialRenderDone = false

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
    for (const annotation of store.annotations.value) {
      if (annotation.pdf && !renderedIds.has(annotation.id)) renderAnnotation(annotation)
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

  function positionPopup(placement: SelectionMenuPlacement) {
    const content = scroll.value?.getRectPositionForPage(placement.pageIndex, placement.rect)
    const metrics = viewportCapability.value?.forDocument(documentId()).getMetrics()
    if (!content || !metrics) return false
    popupPosition.value = {
      x: content.origin.x + content.size.width / 2 - metrics.scrollLeft,
      y: placement.suggestTop ? content.origin.y - metrics.scrollTop : content.origin.y + content.size.height - metrics.scrollTop,
    }
    popupShowBelow.value = !placement.suggestTop
    return true
  }

  async function onMenuPlacement(placement: SelectionMenuPlacement | null) {
    if (!placement || !placement.isVisible) {
      popupVisible.value = false
      return
    }
    if (!positionPopup(placement)) return
    const selectionRect = fromRect(placement.rect)
    overlappingAnnotationId.value = findOverlappingAnnotation(store.annotations.value, placement.pageIndex, selectionRect)?.id ?? null
    pendingSelection = await captureSelection()
    selectedText.value = pendingSelection
      .map((entry) => entry.text)
      .join(' ')
      .trim()
    popupVisible.value = true
  }

  function dismissPopup() {
    popupVisible.value = false
  }

  function clearSelection() {
    selScope()?.clear()
    pendingSelection = []
    overlappingAnnotationId.value = null
  }

  function selectedAnnotation(): AnnotationItem | null {
    const id = overlappingAnnotationId.value
    if (id === null) return null
    return store.annotations.value.find((annotation) => annotation.id === id) ?? null
  }

  async function restyleExisting(id: number, patch: { color?: string; style?: string; note?: string | null }) {
    const previous = store.annotations.value.find((annotation) => annotation.id === id) ?? null
    if (previous) unrenderAnnotation(previous)
    const updated = await store.update(id, patch)
    if (updated) renderAnnotation(updated)
  }

  async function createFromSelection(color: string, style: string, note: string | null) {
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
    }
  }

  async function applyHighlight(color: string, style: string, note?: string) {
    if (overlappingAnnotationId.value !== null) {
      const patch: { color: string; style: string; note?: string } = { color, style }
      if (note !== undefined) patch.note = note
      await restyleExisting(overlappingAnnotationId.value, patch)
    } else {
      await createFromSelection(color, style, note ?? null)
    }
    clearSelection()
    dismissPopup()
  }

  function openNoteDialog() {
    noteText.value = selectedAnnotation()?.note ?? ''
    showNoteDialog.value = true
    dismissPopup()
  }

  async function saveNote(note: string) {
    if (overlappingAnnotationId.value !== null) {
      await restyleExisting(overlappingAnnotationId.value, { note })
    } else {
      await createFromSelection(DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_STYLE, note)
    }
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
      if (capability && !initialRenderDone && store.annotations.value.length > 0) renderAll()
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
    annotations: store.annotations,
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
