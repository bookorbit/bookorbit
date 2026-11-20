import { computed } from 'vue'
import { useInteraction, useInteractionState } from '@embedpdf/vue/interaction'

const PAN_TOOL = 'pan'
const TEXT_SELECTION_TOOL = 'pointer'

export function usePdfInteractionMode() {
  const interaction = useInteraction()
  const activeToolId = useInteractionState((state) => state.activeToolId)
  const isPanning = computed(() => activeToolId.value === PAN_TOOL)

  function activate(toolId: string) {
    try {
      interaction.activateTool(toolId)
    } catch {
      // No document is open yet, so there is no tool to switch.
    }
  }

  function togglePan() {
    activate(isPanning.value ? TEXT_SELECTION_TOOL : PAN_TOOL)
  }

  function activateTextSelection() {
    activate(TEXT_SELECTION_TOOL)
  }

  return { isPanning, togglePan, activateTextSelection }
}
