import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { i18n } from '@/i18n'
import type { Annotation, AnnotationPatch } from './useAnnotations'

interface ReaderAnnotations {
  annotations: Ref<Annotation[]>
  create: (
    bookId: number,
    data: { cfi: string; bookFileId?: number; text: string; color: string; style: string; note?: string | null; chapterTitle?: string | null },
  ) => Promise<Annotation | null>
  update: (bookId: number, id: number, data: AnnotationPatch) => Promise<Annotation | null>
  remove: (bookId: number, id: number) => Promise<boolean>
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
  deleteAnnotation: (cfi: string) => void
}

type SaveOutcome = 'saved' | 'failed' | 'nothing'

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
  deleteAnnotation,
}: ReaderAnnotationActionsOptions) {
  const isSaving = ref(false)

  function selectedAnnotation(): Annotation | null {
    const id = selection.overlappingAnnotationId.value
    if (id === null) return null
    return annotations.annotations.value.find((annotation) => annotation.id === id) ?? null
  }

  async function updateSelectedAnnotation(data: AnnotationPatch, redraw: boolean): Promise<SaveOutcome> {
    const id = selection.overlappingAnnotationId.value
    if (id === null) return 'nothing'

    const updated = await annotations.update(bookId, id, data)
    if (!updated) return 'failed'
    if (redraw && updated.cfi) {
      redrawAnnotation(updated.cfi, updated.color, updated.style)
    }
    return 'saved'
  }

  async function saveHighlight(color: string, style: string, note?: string): Promise<SaveOutcome> {
    if (selection.overlappingAnnotationId.value !== null) {
      const patch: AnnotationPatch = { color, style }
      if (note !== undefined) patch.note = note
      return updateSelectedAnnotation(patch, true)
    }

    const annotationCfi = selection.cfi.value
    if (!selection.text.value || !annotationCfi) return 'nothing'

    const created = await annotations.create(bookId, {
      cfi: annotationCfi,
      bookFileId: fileId,
      text: selection.text.value,
      color,
      style,
      note: note ?? null,
      chapterTitle: chapterTitle.value || null,
    })
    if (!created) return 'failed'
    if (created.cfi) {
      addAnnotation(created.cfi, created.color, created.style)
    }
    return 'saved'
  }

  // One request per save: the dialog stays open while it runs, so a second tap must not send another.
  async function whileSaving(work: () => Promise<void>) {
    if (isSaving.value) return
    isSaving.value = true
    try {
      await work()
    } finally {
      isSaving.value = false
    }
  }

  function handleHighlight(color: string, style: string) {
    return whileSaving(async () => {
      const outcome = await saveHighlight(color, style)
      if (outcome === 'nothing') return
      if (outcome === 'failed') toast.error(i18n.global.t('reader.toast.highlightSaveFailed'))
      selection.dismiss()
    })
  }

  function handleOpenNoteDialog() {
    selection.openNoteDialog(selectedAnnotation()?.note ?? '')
  }

  function handleSaveNote(note: string) {
    return whileSaving(async () => {
      const outcome =
        selection.overlappingAnnotationId.value !== null
          ? await updateSelectedAnnotation({ note }, false)
          : await saveHighlight(DEFAULT_NOTE_HIGHLIGHT_COLOR, DEFAULT_NOTE_HIGHLIGHT_STYLE, note)
      if (outcome === 'failed') {
        toast.error(i18n.global.t('reader.toast.noteSaveFailed'))
        return
      }
      if (selection.overlappingAnnotationId.value === null) selection.dismiss()
      selection.showNoteDialog.value = false
      selection.noteText.value = ''
    })
  }

  // The drawing goes only once the server has the delete, so a failed one leaves the page as it was.
  async function handleDeleteAnnotation(id: number) {
    const annotation = annotations.annotations.value.find((a) => a.id === id)
    if (!annotation) return
    const removed = await annotations.remove(bookId, id)
    if (!removed) {
      toast.error(i18n.global.t('reader.toast.highlightDeleteFailed'))
      return
    }
    if (annotation.cfi) deleteAnnotation(annotation.cfi)
  }

  return { isSaving, handleHighlight, handleOpenNoteDialog, handleSaveNote, handleDeleteAnnotation }
}
