import type { MaybeRefOrGetter } from 'vue'
import { useInteractionManager } from '@embedpdf/plugin-interaction-manager/vue'
import { usePan } from '@embedpdf/plugin-pan/vue'

const TEXT_SELECTION_MODE = 'pointerMode'

export function usePdfInteractionMode(documentId: MaybeRefOrGetter<string>) {
  const { isPanning, provides: pan } = usePan(documentId)
  const { provides: interactionManager } = useInteractionManager(documentId)

  function togglePan() {
    pan.value?.togglePan()
  }

  function activateTextSelection() {
    // EmbedPDF makes pan the default on touch devices, so disablePan() would reactivate pan.
    interactionManager.value?.activate(TEXT_SELECTION_MODE)
  }

  return { isPanning, togglePan, activateTextSelection }
}
