import type { Ref } from 'vue'
import type { Annotation, AnnotationPatch } from './useAnnotations'

interface ReaderAnnotations {
  annotations: Ref<Annotation[]>
  create: (
    bookId: number,
    data: { cfi: string; bookFileId?: number; text: string; color: string; style: string; note?: string | null; chapterTitle?: string | null },
  ) => Promise<Annotation | null>
  update: (bookId: number, id: number, data: AnnotationPatch) => Promise<Annotation | null>
}

interface ReaderSelection {
  text: Ref<string>
  cfi: Ref<string | null>
  overlappingAnnotationId: Ref<number | null>
  showNoteDialog: Ref<boolean>
  noteText: Ref<string>
  dismiss: () => void
  openNoteDialog: (initialNote?: string) => void
}

interface ReaderAnnotationActionsOptions {
  bookId: number
  fileId: number
  chapterTitle: Ref<string | null | undefined>
  annotations: ReaderAnnotations
  selection: ReaderSelection
  addAnnotation: (cfi: string, color: string, style: string) => void
  redrawAnnotation: (cfi: string, color: string, style: string) => void
}

const DEFAULT_NOTE_HIGHLIGHT_COLOR = '#FACC15'
const DEFAULT_NOTE_HIGHLIGHT_STYLE = 'highlight'

export function useReaderAnnotationActions({
  bookId,
  fileId,
  chapterTitle,
  annotations,
  selection,
  addAnnotation,
  redrawAnnotation,
}: ReaderAnnotationActionsOptions) {
  function selectedAnnotation(): Annotation | null {
    const id = selection.overlappingAnnotationId.value
    if (id === null) return null
    return annotations.annotations.value.find((annotation) => annotation.id === id) ?? null
  }

  async function updateSelectedAnnotation(data: AnnotationPatch, redraw: boolean) {
    const id = selection.overlappingAnnotationId.value
    if (id === null) return null

    const updated = await annotations.update(bookId, id, data)
    if (redraw && updated?.cfi) {
      redrawAnnotation(updated.cfi, updated.color, updated.style)
    }
    return updated
  }

  async function handleHighlight(color: string, style: string, note?: string) {
    if (selection.overlappingAnnotationId.value !== null) {
      const patch: AnnotationPatch = { color, style }
      if (note !== undefined) patch.note = note
      await updateSelectedAnnotation(patch, true)
      selection.dismiss()
      return
    }

    const annotationCfi = selection.cfi.value
    if (!selection.text.value || !annotationCfi) return

    const created = await annotations.create(bookId, {
      cfi: annotationCfi,
      bookFileId: fileId,
      text: selection.text.value,
      color,
      style,
      note: note ?? null,
      chapterTitle: chapterTitle.value || null,
    })
    if (created?.cfi) {
      addAnnotation(created.cfi, created.color, created.style)
    }
    selection.dismiss()
  }

  function handleOpenNoteDialog() {
    selection.openNoteDialog(selectedAnnotation()?.note ?? '')
  }

  async function handleSaveNote(note: string) {
    if (selection.overlappingAnnotationId.value !== null) {
      await updateSelectedAnnotation({ note }, false)
    } else {
      await handleHighlight(DEFAULT_NOTE_HIGHLIGHT_COLOR, DEFAULT_NOTE_HIGHLIGHT_STYLE, note)
    }
    selection.showNoteDialog.value = false
    selection.noteText.value = ''
  }

  return { handleHighlight, handleOpenNoteDialog, handleSaveNote }
}
