import { ref } from 'vue'
import type { SelectionDetail } from './useFoliateSelection'

export function useReaderSelection() {
  const visible = ref(false)
  const position = ref({ x: 0, y: 0 })
  const showBelow = ref(false)
  const text = ref('')
  const cfi = ref<string | null>(null)
  const overlappingAnnotationId = ref<number | null>(null)
  const showNoteDialog = ref(false)
  const noteText = ref('')

  function show(detail: SelectionDetail) {
    text.value = detail.text
    cfi.value = detail.cfi ?? null
    position.value = { x: detail.popupPosition.x, y: detail.popupPosition.y }
    showBelow.value = detail.popupPosition.showBelow
    overlappingAnnotationId.value = null
    visible.value = true
  }

  function dismiss() {
    visible.value = false
  }

  function openNoteDialog() {
    noteText.value = ''
    showNoteDialog.value = true
    dismiss()
  }

  return { visible, position, showBelow, text, cfi, overlappingAnnotationId, showNoteDialog, noteText, show, dismiss, openNoteDialog }
}
